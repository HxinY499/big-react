import { REACT_ELEMENT_TYPE, REACT_FRAGMENT_TYPE } from 'shared/ReactSymbols';
import { Props, ReactElementType, Key } from 'shared/ReactTypes';
import {
  createFiberFromElement,
  createFiberFromFragment,
  createWorkInProgress,
  FiberNode,
} from './fiber';
import { ChildDeletion, Placement } from './fiberFlags';
import { Fragment, HostText } from './workTags';

type ExistingChildren = Map<string | number, FiberNode>;

function ChildReconciler(shouldTrackEffect: boolean) {
  // shouldTrackEffect：表示是否需要追踪副作用

  function deleteChild(returnFiber: FiberNode, childToDelete: FiberNode) {
    if (!shouldTrackEffect) {
      return;
    }
    const deletions = returnFiber.deletions;
    if (deletions === null) {
      returnFiber.deletions = [childToDelete];
      returnFiber.flags |= ChildDeletion;
    } else {
      deletions.push(childToDelete);
    }
  }

  function deleteRemainingChildren(returnFiber: FiberNode, currentFirstFiber: FiberNode | null) {
    if (!shouldTrackEffect) return;

    let childToDelete = currentFirstFiber;
    while (childToDelete !== null) {
      deleteChild(returnFiber, childToDelete);
      childToDelete = childToDelete.sibling;
    }
  }

  function reconcileSingleElement(
    returnFiber: FiberNode,
    currentFiber: FiberNode | null,
    element: ReactElementType
  ) {
    const key = element.key;
    while (currentFiber !== null) {
      // update
      // key和type都相同就复用currentFiber，否则就删掉旧的创建新的
      if (currentFiber.key === key) {
        if (element.$$typeof === REACT_ELEMENT_TYPE) {
          if (currentFiber.type === element.type) {
            let props = element.props;
            // 处理reconcileChildrenFibers中1.2的情况
            if (element.type === REACT_FRAGMENT_TYPE) {
              props = element.props.children;
            }
            // 复用FiberNode
            const existing = useFiber(currentFiber, props);
            existing.return = returnFiber;
            // 当前节点可复用，标记上下的节点删除
            deleteRemainingChildren(returnFiber, currentFiber.sibling);
            return existing;
          }
          // key相同 type不同， 删掉
          deleteRemainingChildren(returnFiber, currentFiber);
          break;
        } else {
          if (__DEV__) console.warn('还未实现的react类型', element);
          break;
        }
      } else {
        // key 不同，删掉当前不同的，继续对比sibling
        deleteChild(returnFiber, currentFiber);
        currentFiber = currentFiber.sibling;
      }
    }

    // 根据reactElement创建fiber
    let fiber;
    // 处理reconcileChildrenFibers中1.2的情况
    if (element.type === REACT_FRAGMENT_TYPE) {
      fiber = createFiberFromFragment(element.props.children, key);
    } else {
      fiber = createFiberFromElement(element);
    }
    fiber.return = returnFiber;
    return fiber;
  }

  function reconcileSingleTextNode(
    returnFiber: FiberNode,
    currentFiber: FiberNode | null,
    content: string | number
  ) {
    while (currentFiber !== null) {
      // update
      if (currentFiber.tag === HostText) {
        // 类型没变，可以复用
        const existing = useFiber(currentFiber, { content });
        existing.return = returnFiber;
        // 删掉其他sibling
        deleteRemainingChildren(returnFiber, currentFiber.sibling);
        return existing;
      }
      // 当前不能复用，删掉当前继续对比sibling
      deleteChild(returnFiber, currentFiber);
      currentFiber = currentFiber.sibling;
    }
    const fiber = new FiberNode(HostText, { content }, null);
    fiber.return = returnFiber;
    return fiber;
  }

  function placeSingleChild(fiber: FiberNode) {
    // 根据当前情况判断是否给fiber加Placement标记
    // 是一个优化方式，首屏渲染时只有hostRootFiber需要加Placement标记
    if (shouldTrackEffect && fiber.alternate === null /*null表示首屏渲染*/) {
      fiber.flags |= Placement;
    }
    return fiber;
  }

  function reconcileFiberArray(
    returnFiber: FiberNode,
    currentFirstFiber: FiberNode | null,
    newChild: any[]
  ) {
    // 最后一个可复用fiber在current中的index
    let lastPlaceIndex: number = 0;
    // 创建的最后一个fiber
    let lastNewFiber: FiberNode | null = null;
    // 创建的第一个fiber
    let firstNewFiber: FiberNode | null = null;

    // 1. 将current保存在Map中
    const existingChildren: ExistingChildren = new Map();
    let current = currentFirstFiber;
    while (current !== null) {
      const keyToUse = current.key !== null ? current.key : current.index;
      existingChildren.set(keyToUse, current);
      current = current.sibling;
    }

    for (let i = 0; i < newChild.length; i++) {
      // 2. 遍历newChild，寻找是否可复用
      // after是更新后的reactElement
      const after = newChild[i];
      const newFiber = updateFromMap(returnFiber, existingChildren, i, after);

      // 更新后的结果是false、null等
      if (newFiber === null) continue;

      // 3. 标记移动还是插入
      newFiber.index = i;
      newFiber.return = returnFiber;

      if (lastNewFiber === null) {
        lastNewFiber = newFiber;
        firstNewFiber = newFiber;
      } else {
        lastNewFiber.sibling = newFiber;
        lastNewFiber = lastNewFiber.sibling;
      }

      if (!shouldTrackEffect) continue;

      const current = newFiber.alternate;
      if (current !== null) {
        const oldIndex = current.index;
        if (oldIndex < lastPlaceIndex) {
          // 移动
          newFiber.flags |= Placement;
          continue;
        } else {
          // 不移动
          lastPlaceIndex = oldIndex;
        }
      } else {
        // mount
        newFiber.flags |= Placement;
      }
    }

    // 4. 将Map中剩下的节点删除
    existingChildren.forEach((fiber) => {
      deleteChild(returnFiber, fiber);
    });

    return firstNewFiber;
  }

  function updateFromMap(
    returnFiber: FiberNode,
    existingChildren: ExistingChildren,
    index: number,
    element: any
  ): FiberNode | null {
    // 判断更新后reactElement的所有类型

    const keyToUse = element.key !== null ? element.key : element.index;
    // before是更新前的fiberNode
    const before = existingChildren.get(keyToUse) || null;

    // 根据更新后的element的类型分别判断
    if (typeof element === 'string' || typeof element === 'number') {
      // 如果取到了before，判断能否复用，此时key已相同，因为是以key为键从map中找的，要判断type了
      if (before) {
        // HostText
        if (before.tag === HostText) {
          // 可以复用，map中删掉
          existingChildren.delete(keyToUse);
          return useFiber(before, { content: element + '' });
        }
      }
      return new FiberNode(HostText, { content: element + '' }, null);
    }

    if (typeof element === 'object' && element !== null) {
      switch (element.$$typeof) {
        case REACT_ELEMENT_TYPE:
          // 处理reconcileChildrenFibers中1.2的情况
          if (element.type === REACT_FRAGMENT_TYPE) {
            return updateFragment(returnFiber, before, element, keyToUse, existingChildren);
          }
          if (before) {
            if (before.type === element.type) {
              existingChildren.delete(keyToUse);
              return useFiber(before, element.props);
            }
          }

          return createFiberFromElement(element);
      }

      // 处理reconcileChildrenFibers中1.3的情况
      if (Array.isArray(element)) {
        return updateFragment(returnFiber, before, element, keyToUse, existingChildren);
      }
    }
    return null;
  }

  return function reconcileChildrenFibers(
    returnFiber: FiberNode,
    currentFiber: FiberNode | null,
    newChild?: any // ReactElementType
  ) {
    // 1.判断fragment
    // 1.1 根节点就是fragment
    /*
    * <>
        <div></div>
        <div></div>
      </>
    */
    const isUnkeyedTopLevelFragment =
      typeof newChild === 'object' &&
      newChild !== null &&
      newChild.type === REACT_FRAGMENT_TYPE &&
      newChild.key === null;

    if (isUnkeyedTopLevelFragment) {
      // 就会进入下面 多节点情况 的分支
      newChild = newChild?.props.children;
    }
    // 1.2 fragment和其他组件平级，在后面处理
    /*
    * <ul>
        <>
         <li>1</li>
         <li>2</li>
        </>
        <li>3</li>
        <li>4</li>
      </ul>
    */
    // 1.3 数组形式的fragment，在后面处理
    /*
   // arr = [<li>c</li>, <li>d</li>]
      <ul>
        <li>a</li>
        <li>b</li>
        {arr}
      </ul>
   */

    // 判断新的fiberNode是什么类型
    if (typeof newChild === 'object' && typeof newChild !== null) {
      // 2. 单一节点（除了HostText）
      switch (newChild.$$typeof) {
        case REACT_ELEMENT_TYPE:
          return placeSingleChild(reconcileSingleElement(returnFiber, currentFiber, newChild));
      }
      // 3. 多节点情况
      if (Array.isArray(newChild)) {
        return reconcileFiberArray(returnFiber, currentFiber, newChild);
      }
    }

    // 4. HostText
    if (typeof newChild === 'number' || typeof newChild === 'string') {
      return placeSingleChild(reconcileSingleTextNode(returnFiber, currentFiber, newChild));
    }

    if (currentFiber !== null) {
      // 兜底删除
      deleteRemainingChildren(returnFiber, currentFiber);
    }

    if (__DEV__) {
      console.warn('未实现的reconcile类型', newChild);
    }

    return null;
  };
}

function useFiber(fiber: FiberNode, pendingProps: Props): FiberNode {
  const clone = createWorkInProgress(fiber, pendingProps);
  clone.index = 0;
  clone.sibling = null;
  return clone;
}

function updateFragment(
  returnFiber: FiberNode,
  current: FiberNode | null,
  elements: any[],
  key: Key,
  existingChildren: ExistingChildren
) {
  let fiber;
  if (!current || current.tag !== Fragment) {
    fiber = createFiberFromFragment(elements, key);
  } else {
    existingChildren.delete(key);
    fiber = useFiber(current, elements);
  }

  fiber.return = returnFiber;
  return fiber;
}

export const reconcileChildrenFibers = ChildReconciler(true);
export const mountChildrenFibers = ChildReconciler(false);
