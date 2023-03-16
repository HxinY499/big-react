import {
  appendChildToContainer,
  commitTextUpdate,
  Container,
  inserChildToContainer,
  Instance,
  removeChild,
} from 'hostConfig';
import { FiberNode, FiberRootNode } from './fiber';
import { ChildDeletion, MutationMask, NoFlags, Placement, Update } from './fiberFlags';
import { FunctionComponent, HostComponent, HostRoot, HostText } from './workTags';

let nextEffect: FiberNode | null = null;

export function commitMutationEffects(finishedWork: FiberNode) {
  nextEffect = finishedWork;

  while (nextEffect !== null) {
    const child: FiberNode | null = nextEffect.child;

    // 以下又是一个DFS过程
    // 向下遍历，直到找到第一个不存在subtreeFlags的节点
    if ((nextEffect.subtreeFlags & MutationMask) !== NoFlags && child !== null) {
      // MutationMask是该阶段要操作的flag类型，包含三类
      nextEffect = child;
    } else {
      // 找到之后再向上遍历(执行对应操作)，如果存在sibling的话，继续从sibling节点开始向下遍历，如此往复
      up: while (nextEffect !== null) {
        commitMutationEffectsOnFiber(nextEffect);
        const sibling: FiberNode | null = nextEffect.sibling;

        if (sibling !== null) {
          nextEffect = sibling;
          break up;
        }
        nextEffect = nextEffect.return;
      }
    }
  }
}

function commitMutationEffectsOnFiber(finishedWork: FiberNode) {
  const flags = finishedWork.flags;

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
        commitDeletion(childToDelete);
      });
    }
    finishedWork.flags &= ~ChildDeletion;
  }
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

function commitDeletion(childToDelete: FiberNode) {
  let rootHostNode: FiberNode | null = null;

  if (__DEV__) {
    console.warn('Mutation阶段，执行Deletion对应操作，要删除的fiber：', childToDelete);
  }

  // 递归子树，目的是：
  //  1. 针对要删除节点下每个子节点进行处理，例如解绑ref或useEffect unmount等
  //  2. 找到childToDelete下的第一个DOM，为了删除
  commitNestedComponent(childToDelete, (unmountFiber) => {
    switch (unmountFiber.tag) {
      case HostComponent:
        if (rootHostNode === null) {
          rootHostNode = unmountFiber;
        }
        // TODO 解绑ref
        return;
      case HostText:
        if (rootHostNode === null) {
          rootHostNode = unmountFiber;
        }
        return;

      case FunctionComponent:
        // TODO useEffect unmount 解绑ref
        return;

      default:
        if (__DEV__) {
          console.warn('未处理的unmount类型', unmountFiber);
        }
        break;
    }
  });

  // 移除rootHostNode的DOM
  if (rootHostNode !== null) {
    const hostParent = getHostParent(childToDelete);
    if (hostParent !== null && rootHostNode !== null)
      removeChild((rootHostNode as FiberNode).stateNode, hostParent);
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
