import { ReactElementType } from 'shared/ReactTypes';
import { mountChildrenFibers, reconcileChildrenFibers } from './childFibers';
import { FiberNode } from './fiber';
import { renderWithHooks } from './fiberHooks';
import { Lane } from './fiberLanes';
import { processUpdateQueue, UpdateQueue } from './updateQueue';
import { Fragment, FunctionComponent, HostComponent, HostRoot, HostText } from './workTags';
import { Ref } from './fiberFlags';

/*
* -作用：
    为传入的wip生成子fiberNode
* -解释：
*   对于 <A> <B/> </A> 的ReactElement结构
*   当进入A的beginWork时，通过对比B的current fiberNode和B的 reactElement，
*   生成B对应的新的wip fiberNode
*/
export const beginWork = (wip: FiberNode, renderLane: Lane): FiberNode | null => {
  // 比较，返回子fiberNode
  switch (wip.tag) {
    case HostRoot:
      // 1. 计算状态最新值
      // 2. 创造子fiberNode
      return updateHostRoot(wip, renderLane);
    case HostComponent:
      // 1. 创造子fiberNode
      return updateHostComponent(wip);
    case HostText:
      // HostText没有子节点
      return null;
    case FunctionComponent:
      return updateFunctionComponent(wip, renderLane);
    case Fragment:
      return updateFragment(wip);
    default:
      if (__DEV__) {
        console.warn('beginWork未实现的类型');
      }
      return null;
  }
};

function updateHostRoot(wip: FiberNode, renderLane: Lane) {
  // 任务：
  // 1. 计算状态最新值
  // 2. 创造子fiberNode
  const baseState = wip.memorizedState;
  let updateQueue = wip.updateQueue as UpdateQueue<Element>;
  const pending = updateQueue?.shared?.pending;
  updateQueue.shared.pending = null;
  const { memorizedState } = processUpdateQueue(baseState, pending, renderLane);
  wip.memorizedState = memorizedState;

  // 对于hostRoot，memorizedState其实就是子ReactElement
  const nextChildren = wip.memorizedState;
  reconcileChildren(wip, nextChildren);

  return wip.child;
}

function updateHostComponent(wip: FiberNode) {
  // 任务：
  // 1. 创造子fiberNode
  const nextProps = wip.pendingProps;
  // reactElement结构中，children在props里，那么nextChildren就在pendingProps中
  const nextChildren = nextProps.children;
  markRef(wip.alternate, wip);
  reconcileChildren(wip, nextChildren);
  return wip.child;
}

function updateFunctionComponent(wip: FiberNode, renderLane: Lane) {
  const nextProps = wip.pendingProps;
  const nextChildren = renderWithHooks(wip, renderLane);
  reconcileChildren(wip, nextChildren);
  return wip.child;
}

function updateFragment(wip: FiberNode) {
  const nextChildren = wip.pendingProps;
  reconcileChildren(wip, nextChildren);
  return wip.child;
}

function reconcileChildren(wip: FiberNode, children?: ReactElementType) {
  const current = wip.alternate;
  if (current !== null) {
    // update
    wip.child = reconcileChildrenFibers(wip, current.child, children);
  } else {
    // mount
    wip.child = mountChildrenFibers(wip, null, children);
  }
}

function markRef(current: FiberNode | null, workInProgress: FiberNode) {
  const ref = workInProgress.ref;
  if ((current === null && ref !== null) || (current !== null && current.ref !== ref)) {
    workInProgress.flags |= Ref;
  }
}
