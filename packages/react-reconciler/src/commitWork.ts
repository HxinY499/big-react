import {
  appendChildToContainer,
  commitTextUpdate,
  Container,
  inserChildToContainer,
  Instance,
  removeChild,
} from 'hostConfig';
import { FiberNode, FiberRootNode, PendingPassiveEffects } from './fiber';
import {
  ChildDeletion,
  Flags,
  MutationMask,
  LayoutMask,
  NoFlags,
  PassiveEffect,
  PassiveMask,
  Placement,
  Update,
  Ref,
} from './fiberFlags';
import { Effect, FCUpdateQueue } from './fiberHooks';
import { HookHasEffect } from './hookEffectTags';
import { FunctionComponent, HostComponent, HostRoot, HostText } from './workTags';

let nextEffect: FiberNode | null = null;

/**
 * @description: DFS过程，遍历每一个存在subtreeFlags的节点，执行相应操作
 */
function commitEffects(
  phrase: 'mutation' | 'layout',
  mask: Flags,
  callback: (fiber: FiberNode, root: FiberRootNode) => void
) {
  return (finishedWork: FiberNode, root: FiberRootNode) => {
    nextEffect = finishedWork;

    while (nextEffect !== null) {
      const child: FiberNode | null = nextEffect.child;

      // 以下又是一个DFS过程
      // 向下遍历，直到找到第一个不存在subtreeFlags的节点
      if ((nextEffect.subtreeFlags & mask) !== NoFlags && child !== null) {
        // MutationMask是该阶段要操作的flag类型，包含三类
        nextEffect = child;
      } else {
        // 找到之后再向上遍历(执行对应操作)，如果存在sibling的话，继续从sibling节点开始向下遍历，如此往复
        up: while (nextEffect !== null) {
          callback(nextEffect, root);
          const sibling: FiberNode | null = nextEffect.sibling;

          if (sibling !== null) {
            nextEffect = sibling;
            break up;
          }
          nextEffect = nextEffect.return;
        }
      }
    }
  };
}

function commitMutationEffectsOnFiber(finishedWork: FiberNode, root: FiberRootNode) {
  const { flags, tag } = finishedWork;

  // Placement 执行操作，然后移除Placement标记
  if ((flags & Placement) !== NoFlags) {
    commitPlacement(finishedWork);
    finishedWork.flags &= ~Placement;
  }
  // Update 执行操作，然后移除Update标记
  if ((flags & Update) !== NoFlags) {
    commitUpdate(finishedWork);
    finishedWork.flags &= ~Update;
  }
  // ChildDeletion 执行操作，然后移除PChildDeletion标记
  if ((flags & ChildDeletion) !== NoFlags) {
    const deletions = finishedWork.deletions;
    if (deletions !== null) {
      deletions.forEach((childToDelete) => {
        commitDeletion(childToDelete, root);
      });
    }
    finishedWork.flags &= ~ChildDeletion;
  }
  if ((flags & PassiveEffect) !== NoFlags) {
    // 收集回调
    commitPassiveEffect(finishedWork, root, 'update');
    finishedWork.flags &= ~PassiveEffect;
  }
  if ((flags & Ref) !== NoFlags && tag === HostComponent) {
    // 解绑旧的ref
    safelyDetachRef(finishedWork);
    finishedWork.flags &= ~Ref;
  }
}
function commitLayoutEffectsOnFiber(finishedWork: FiberNode, root: FiberRootNode) {
  const { flags, tag } = finishedWork;
  // Ref 执行操作，然后移除Placement标记
  if ((flags & Ref) !== NoFlags && tag === HostComponent) {
    // 绑定新的ref
    safelyAttachRef(finishedWork);
    finishedWork.flags &= ~Ref;
  }
}
// mutation阶段
export const commitMutationEffects = commitEffects(
  'mutation',
  MutationMask | PassiveMask,
  commitMutationEffectsOnFiber
);
// layout阶段
export const commitLayoutEffects = commitEffects('layout', LayoutMask, commitLayoutEffectsOnFiber);

function commitPassiveEffect(
  fiber: FiberNode,
  root: FiberRootNode,
  type: keyof PendingPassiveEffects
) {
  // update
  if (
    fiber.tag !== FunctionComponent ||
    (type === 'update' && (fiber.flags & PassiveEffect) === NoFlags)
  ) {
    return;
  }
  const updateQueue = fiber.updateQueue as FCUpdateQueue<any>;
  if (updateQueue !== null) {
    if (updateQueue.lastEffect === null && __DEV__) {
      console.error('当FC存在PassiveEffect flag时，不应该不存在useEffect');
    }
    root.pendingPassiveEffects[type].push(updateQueue.lastEffect!);
  }
}

function commitHookEffectList(
  flags: Flags,
  lastEffect: Effect,
  callback: (effect: Effect) => void
) {
  let effect = lastEffect.next!;
  do {
    if ((effect.tag & flags) === flags) {
      callback(effect);
    }
    effect = effect.next!;
  } while (effect !== lastEffect.next);
}

export function commitHookEffectListUnmount(flags: Flags, lastEffect: Effect) {
  commitHookEffectList(flags, lastEffect, (effect) => {
    const destroy = effect.destroy;
    if (typeof destroy === 'function') {
      destroy();
    }
    effect.tag &= ~HookHasEffect;
  });
}

export function commitHookEffectListDestroy(flags: Flags, lastEffect: Effect) {
  commitHookEffectList(flags, lastEffect, (effect) => {
    const destroy = effect.destroy;
    if (typeof destroy === 'function') {
      destroy();
    }
  });
}

export function commitHookEffectListCreate(flags: Flags, lastEffect: Effect) {
  commitHookEffectList(flags, lastEffect, (effect) => {
    const create = effect.create;
    if (typeof create === 'function') {
      effect.destroy = create();
    }
  });
}

function commitUpdate(fiber: FiberNode) {
  if (__DEV__) {
    console.warn('Mutation阶段，执行Update对应操作，正在Update的fiber：', fiber);
  }
  switch (fiber.tag) {
    case HostText:
      const text = fiber.memorizedProps.content;
      return commitTextUpdate(fiber.stateNode, text);
    // case HostComponent:

    default:
      if (__DEV__) {
        console.warn('未实现的Update类型', fiber);
      }
      break;
  }
}

function recordHostChildrenToDelete(childrenToDelete: FiberNode[], unmountFiber: FiberNode) {
  // 1. 找到第一个节点
  let lastOne = childrenToDelete.at(-1);

  if (!lastOne) {
    childrenToDelete.push(unmountFiber);
  } else {
    let node = lastOne.sibling;
    while (node !== null) {
      if (unmountFiber === node) {
        childrenToDelete.push(unmountFiber);
      }
      node = node.sibling;
    }
  }
  // 2. 每找到一个host节点，判断这个节点是不是第一步找到的节点的兄弟节点
}

function commitDeletion(childToDelete: FiberNode, root: FiberRootNode) {
  const rootChildToDelete: FiberNode[] = [];

  if (__DEV__) {
    console.warn('Mutation阶段，执行Deletion对应操作，要删除的fiber：', childToDelete);
  }

  // 递归子树，目的是：
  //  1. 针对要删除节点下每个子节点进行处理，例如解绑ref或useEffect unmount等
  //  2. 找到childToDelete下的第一个DOM，为了删除
  commitNestedComponent(childToDelete, (unmountFiber) => {
    switch (unmountFiber.tag) {
      case HostComponent:
        recordHostChildrenToDelete(rootChildToDelete, unmountFiber);
        // 解绑ref
        safelyDetachRef(unmountFiber);
        return;
      case HostText:
        recordHostChildrenToDelete(rootChildToDelete, unmountFiber);
        return;

      case FunctionComponent:
        // TODO useEffect unmount 解绑ref
        commitPassiveEffect(unmountFiber, root, 'unmount');
        return;

      default:
        if (__DEV__) {
          console.warn('未处理的unmount类型', unmountFiber);
        }
        break;
    }
  });

  // 移除rootHostNode的DOM
  if (rootChildToDelete.length > 0) {
    const hostParent = getHostParent(childToDelete);
    if (hostParent !== null) {
      rootChildToDelete.forEach((node) => {
        removeChild(node.stateNode, hostParent);
      });
    }
  }

  // 让它能够垃圾回收
  childToDelete.return = null;
  childToDelete.child = null;
}

function commitNestedComponent(root: FiberNode, onCommitUnmount: (fiber: FiberNode) => void) {
  let node = root;
  while (true) {
    onCommitUnmount(node);

    if (node.child !== null) {
      // 向下遍历
      node.child.return = node;
      node = node.child;
      continue;
    }

    if (node === root) return;

    while (node.sibling === null) {
      if (node.return === null || node.return === root) {
        return;
      }
      // 向上归
      node = node.return;
    }
    node.sibling.return = node.return;
    node = node.sibling;
  }
}

function commitPlacement(finishedWork: FiberNode) {
  if (__DEV__) {
    console.warn('Mutation阶段，执行Placement对应操作，要Placement的fiber：', finishedWork);
  }

  // 找到parent对应的DOM
  const hostParent = getHostParent(finishedWork);

  // 找到sibling对应的DOM
  const hostSibling = getHostSibling(finishedWork);
  if (hostParent) {
    // 找到当前fiber对应的DOM，并插到hostParent中
    insertOrAppendPlacementNodeIntoContainer(finishedWork, hostParent, hostSibling);
  }
}

/**
 * @description: 绑定ref
 */
function safelyAttachRef(fiber: FiberNode) {
  const ref = fiber.ref;
  if (ref !== null) {
    const instance = fiber.stateNode;
    if (typeof ref === 'function') {
      ref(instance);
    } else {
      ref.current = instance;
    }
  }
}
/**
 * @description: 解绑ref
 */

function safelyDetachRef(fiber: FiberNode) {
  const ref = fiber.ref;
  if (ref !== null) {
    if (typeof ref === 'function') {
      ref(null);
    } else {
      ref.current = null;
    }
  }
}

function getHostSibling(fiber: FiberNode) {
  let node: FiberNode = fiber;
  findSibling: while (true) {
    while (node.sibling === null) {
      const parent = node.return;

      if (parent === null || parent.tag === HostComponent || parent.tag === HostRoot) {
        return null;
      }
      node = parent;
    }
    node.sibling.return = node.return;
    node = node.sibling;

    while (node.tag !== HostText && node.tag !== HostComponent) {
      if ((node.flags & Placement) !== NoFlags) {
        continue findSibling;
      }
      if (node.child === null) {
        continue findSibling;
      } else {
        node.child.return = node;
        node = node.child;
      }
    }

    if ((node.flags & Placement) === NoFlags) {
      return node.stateNode;
    }
  }
}

function getHostParent(fiber: FiberNode): Container | null {
  let parent = fiber.return;

  while (parent) {
    const parentTag = parent.tag;
    if (parentTag === HostComponent) {
      return parent.stateNode as Container;
    }
    if (parentTag === HostRoot) {
      return (parent.stateNode as FiberRootNode).container as Container;
    }
    parent = parent.return;
  }

  if (__DEV__) {
    console.warn('未找到hostParent');
  }
  return null;
}

function insertOrAppendPlacementNodeIntoContainer(
  finishedWork: FiberNode,
  hostParent: Container,
  before?: Instance
) {
  if (finishedWork.tag === HostComponent || finishedWork.tag === HostText) {
    if (before) {
      inserChildToContainer(finishedWork.stateNode, hostParent, before);
    } else {
      appendChildToContainer(hostParent, finishedWork.stateNode);
    }
    return;
  }
  const child = finishedWork.child;
  if (child !== null) {
    appendChildToContainer(hostParent, child.stateNode);
    let sibling = child.sibling;
    while (sibling !== null) {
      appendChildToContainer(hostParent, sibling.stateNode);
      sibling = sibling.sibling;
    }
  }
}
