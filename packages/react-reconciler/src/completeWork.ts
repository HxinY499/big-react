import { appendInitialChild, Container, createInstance, createTextInstance } from 'hostConfig';
import { updateFiberProps } from 'react-dom/src/SyntheticEvent';
import { FiberNode } from './fiber';
import { NoFlags, Update } from './fiberFlags';
import { Fragment, FunctionComponent, HostComponent, HostRoot, HostText } from './workTags';

/*
* -作用：
    1. 将flags向上冒泡
    2. 为fiber创建dom
*/
export const completeWork = (wip: FiberNode): FiberNode | null => {
  const newProps = wip.pendingProps;
  const current = wip.alternate;
  switch (wip.tag) {
    case HostRoot:
    case FunctionComponent:
    case Fragment:
      bubbleProperties(wip);
      return null;
      return null;
    case HostComponent:
      if (current !== null && wip.stateNode) {
        // update
        // props是否变化，变了就打Update flag

        updateFiberProps(wip.stateNode, newProps);
      } else {
        // mount
        // 1. 构建dom
        const instance = createInstance(wip.type, newProps);
        // 2. 将dom插入到dom树中
        appendAllChildren(instance, wip);
        wip.stateNode = instance;
      }
      bubbleProperties(wip);
      return null;
    case HostText:
      if (current !== null && wip.stateNode) {
        // update
        const oldText = current.memorizedProps.content;
        const newText = newProps.content;
        if (oldText !== newText) {
          markUpdate(wip);
        }
      } else {
        // mount
        // 1. 构建dom
        const instance = createTextInstance(newProps.content);
        wip.stateNode = instance;
      }
      bubbleProperties(wip);
      return null;
    default:
      if (__DEV__) {
        console.warn('completeWork未实现的类型');
      }
      bubbleProperties(wip);
      return null;
  }
};

function appendAllChildren(parent: Container, wip: FiberNode) {
  let node = wip.child;
  while (node !== null) {
    if (node.tag === HostComponent || node.tag === HostText) {
      appendInitialChild(parent, node?.stateNode);
    } else if (node.child !== null) {
      // react组件只是react的一种数据结构，最终表示的是原生dom
      node.child.return = node;
      node = node.child;
      continue;
    }

    if (node === wip) {
      return;
    }

    while (node.sibling === null) {
      if (node.return === null || node.return === wip) {
        return;
      }
      node = node?.return;
    }
    node.sibling.return = node.return;
    node = node.sibling;
  }
}

function bubbleProperties(wip: FiberNode) {
  // 将后代flags存在当前节点的subtreeFlags上
  let subtreeFlags = NoFlags;
  let child = wip.child;

  while (child !== null) {
    // 按位或方式将子fiberNode的subtreeFlags附加在当前节点的subtreeFlags上
    subtreeFlags |= child.subtreeFlags;
    // 在包含子节点本身的flags
    // 此时fiberNode的subtreeFlags就包含了子节点的subtreeFlags和flags，也就是全部子节点的flags
    subtreeFlags |= child.flags;

    child.return = wip;
    child = child.sibling;
  }

  wip.subtreeFlags |= subtreeFlags;
}

function markUpdate(fiber: FiberNode) {
  fiber.flags |= Update;
}
