import { scheduleMicroTask } from 'hostConfig';
import {
  unstable_scheduleCallback,
  unstable_NormalPriority,
  unstable_shouldYield,
  unstable_cancelCallback,
} from 'scheduler';
import { beginWork } from './beginWork';
import {
  commitHookEffectListCreate,
  commitHookEffectListDestroy,
  commitHookEffectListUnmount,
  commitLayoutEffects,
  commitMutationEffects,
} from './commitWork';
import { completeWork } from './completeWork';
import { createWorkInProgress, FiberNode, FiberRootNode, PendingPassiveEffects } from './fiber';
import { MutationMask, NoFlags, PassiveMask } from './fiberFlags';
import {
  getHighestPriorityLane,
  Lane,
  markRootFinished,
  mergeLanes,
  NoLane,
  SyncLane,
} from './fiberLanes';
import { HookHasEffect, Passive } from './hookEffectTags';
import { flushSyncCallbacks, scheduleSyncCallback } from './syncTashQueue';
import { HostRoot } from './workTags';
import { laneToSchedulerPriority } from './fiberLanes';

let workInProgress: FiberNode | null = null;
let wipRootRenderLane: Lane = NoLane;
let rootDoseHasPassiveEffect: boolean = false;

type RootExitStatue = number;
const RootInComplete = 1;
const RootCompleted = 2;
// TODO 执行过程中报错了

function prepareFreshStack(root: FiberRootNode, lane: Lane) {
  root.finishedLane = NoLane;
  root.finishedWork = null;
  workInProgress = createWorkInProgress(root.current, {});
  wipRootRenderLane = lane;
}

export function scheduleUpdateOnFiber(fiber: FiberNode, lane: Lane) {
  // TODO 调度
  // 向上找到fiberRootNode
  const root = markUpdateFromFiberToRoot(fiber);
  markRootUpdated(root, lane);
  ensureRootIsScheduled(root);
  // renderRoot(root);
}

// schedule阶段入口
function ensureRootIsScheduled(root: FiberRootNode) {
  const updateLane = getHighestPriorityLane(root.pendingLanes);

  const existingCallbackNode = root.callbackNode;

  if (updateLane === NoLane) {
    if (existingCallbackNode !== null) {
      unstable_cancelCallback(existingCallbackNode);
    }
    root.callbackNode = null;
    root.callbackPriority = NoLane;
    return;
  }

  const cuPriority = updateLane;
  const prevPriority = root.callbackPriority;
  if (cuPriority === prevPriority) {
    return;
  }

  if (existingCallbackNode !== null) {
    unstable_cancelCallback(existingCallbackNode);
  }

  let newCallbackNode = null;

  if (updateLane === SyncLane) {
    // 同步优先级，微任务调度
    if (__DEV__) {
      console.log('在微任务中调度，优先级：', updateLane);
    }
    // 把任务收集起来
    scheduleSyncCallback(performSyncWorkOnRoot.bind(null, root));
    // 统一调用
    scheduleMicroTask(flushSyncCallbacks);
  } else {
    // 其他优先级，宏任务调度
    const schedulerPriority = laneToSchedulerPriority(updateLane);
    // @ts-ignore
    newCallbackNode = unstable_scheduleCallback(
      schedulerPriority,
      performConcurrentWorkOnRoot.bind(null, root)
    );
  }

  root.callbackNode = newCallbackNode;
  root.callbackPriority = cuPriority;
}

function markRootUpdated(root: FiberRootNode, lane: Lane) {
  root.pendingLanes = mergeLanes(root.pendingLanes, lane);
}

function markUpdateFromFiberToRoot(fiber: FiberNode) {
  // 向上找到fiberRootNode
  let node = fiber;
  let parent = node.return;
  while (parent !== null) {
    node = parent;
    parent = node.return;
  }
  if (node.tag === HostRoot) {
    return node.stateNode;
  }
  return null;
}

function performSyncWorkOnRoot(root: FiberRootNode) {
  const nextLane = getHighestPriorityLane(root.pendingLanes);
  if (nextLane !== SyncLane) {
    // 两种可能
    // 1. 其他比SyncLane低的优先级
    // 2. NoLane
    // 批处理的return条件
    ensureRootIsScheduled(root);
    return;
  }

  const exitStatus = renderRoot(root, nextLane, false);

  if (exitStatus == RootCompleted) {
    const finishedWork = root.current.alternate;
    root.finishedWork = finishedWork;
    root.finishedLane = nextLane;
    wipRootRenderLane = NoLane;

    // 阶段二：commit阶段开始
    // 根据wip 这颗fiberNode树，执行树中每个节点的flags
    commitRoot(root);
  } else {
  }
}

function performConcurrentWorkOnRoot(root: FiberRootNode, didTimeout: boolean): any {
  // 保证useEffect回调都执行了
  const curCallback = root.callbackNode;
  const didFlushPassiveEffect = flushPassiveEffects(root.pendingPassiveEffects);
  if (didFlushPassiveEffect) {
    // 执行useEffect回调时产生了更改优先级更新，当前的更新不能继续执行了
    if (root.callbackNode !== curCallback) {
      return null;
    }
  }

  const lane = getHighestPriorityLane(root.pendingLanes);
  const curCallbackNode = root.callbackNode;
  if (lane === NoLane) {
    return null;
  }
  // SyncLane或者任务过期后，优先级提升为最高
  const needSync = lane === SyncLane || didTimeout;
  // render流程
  const exitStatus = renderRoot(root, lane, !needSync);

  ensureRootIsScheduled(root);

  if (exitStatus === RootInComplete) {
    // 未结束状态，说明中断
    if (root.callbackNode !== curCallbackNode) {
      // callbackNode不同，代表有更高优先级更新插入，停止该更新的继续调度
      return null;
    }
    return performConcurrentWorkOnRoot.bind(null, root);
  }
  if (exitStatus === RootCompleted) {
    const finishedWork = root.current.alternate;
    root.finishedWork = finishedWork;
    root.finishedLane = lane;
    wipRootRenderLane = NoLane;

    // 阶段二：commit阶段开始
    // 根据wip 这颗fiberNode树，执行树中每个节点的flags
    commitRoot(root);
  }
}

function renderRoot(root: FiberRootNode, lane: Lane, shouldTimeSlice: boolean) {
  if (__DEV__) {
    console.warn(`开始${shouldTimeSlice ? '并发' : '同步'}更新的render流程`, root);
  }

  // 还可能是中断过的更新恢复执行，如果是这样不需要初始化。所以只有lane不同才初始化
  if (wipRootRenderLane !== lane) {
    // 初始化，生成当前更新的wip
    prepareFreshStack(root, lane);
  }

  do {
    try {
      // 阶段一：render阶段开始
      if (__DEV__) {
        console.warn('render阶段开始', workInProgress);
      }
      shouldTimeSlice ? workLoopConcurrent() : workLoopSync();
      break;
    } catch (error) {
      if (__DEV__) {
        console.warn('workLoop发生错误', error);
      }
      workInProgress = null;
    }
  } while (true);

  // 中断执行
  if (shouldTimeSlice && workInProgress !== null) {
    return RootInComplete;
  }
  //render流程执行完了
  if (!shouldTimeSlice && workInProgress !== null && __DEV__) {
    console.error(`render阶段结束时wip应该为null，但是此时wip不为null`);
  }
  // TODO 报错
  return RootCompleted;
}

function flushPassiveEffects(pendingPassiveEffects: PendingPassiveEffects) {
  let didFlushPassiveEffect = false;
  pendingPassiveEffects.unmount.forEach((effect) => {
    didFlushPassiveEffect = true;
    commitHookEffectListUnmount(Passive, effect);
  });
  pendingPassiveEffects.unmount = [];

  pendingPassiveEffects.update.forEach((effect) => {
    didFlushPassiveEffect = true;
    commitHookEffectListDestroy(Passive | HookHasEffect, effect);
  });
  pendingPassiveEffects.update.forEach((effect) => {
    didFlushPassiveEffect = true;
    commitHookEffectListCreate(Passive | HookHasEffect, effect);
  });
  pendingPassiveEffects.update = [];
  flushSyncCallbacks();
  return didFlushPassiveEffect;
}

function workLoopSync() {
  while (workInProgress !== null) {
    performUnitOfWork(workInProgress);
  }
}
function workLoopConcurrent() {
  while (workInProgress !== null && !unstable_shouldYield()) {
    performUnitOfWork(workInProgress);
  }
}

function performUnitOfWork(fiber: FiberNode) {
  const next = beginWork(fiber, wipRootRenderLane);
  fiber.memorizedProps = fiber.pendingProps;

  if (next === null) {
    completeUnitOfWork(fiber);
  } else {
    workInProgress = next;
  }
}

function completeUnitOfWork(fiber: FiberNode) {
  let node: FiberNode | null = fiber;

  do {
    completeWork(node);
    const sibling = node.sibling;

    if (sibling !== null) {
      workInProgress = sibling;
      return;
    }

    node = node.return;
    workInProgress = node;
  } while (node !== null);
}

function commitRoot(root: FiberRootNode) {
  // 任务：
  // 1. fiber树的切换
  // 2. 执行Placement对应操作
  const finishedWork = root.finishedWork;

  if (finishedWork === null) {
    return;
  }

  if (__DEV__) {
    console.warn('commit阶段开始', finishedWork);
  }
  const lane = root.finishedLane;

  if (lane === NoLane && __DEV__) {
    console.error('commit阶段finishedLane不应该是NoLane');
  }

  root.finishedWork = null; // 重置
  root.finishedLane = NoLane; // 重置

  // 去掉当前调度的lane
  // 调度的是render阶段，也就是说render阶段可能会被打断
  // 但是commit阶段一旦开始就同步执行完成
  markRootFinished(root, lane);

  // 调度useEffect
  if (
    (finishedWork.flags & PassiveMask) !== NoFlags ||
    (finishedWork.subtreeFlags & PassiveMask) !== NoFlags
  ) {
    if (!rootDoseHasPassiveEffect) {
      rootDoseHasPassiveEffect = true;
      // 调度副作用
      unstable_scheduleCallback(unstable_NormalPriority, () => {
        // 执行副作用
        flushPassiveEffects(root.pendingPassiveEffects);
        return;
      });
    }
  }

  // 判断是否存在3个字阶段需要执行的操作
  // root.flags  root.subtreeFlags
  const subtreeHasEffect = (finishedWork.subtreeFlags & MutationMask) !== NoFlags;
  const rootHasEffect = (finishedWork.flags & MutationMask) !== NoFlags;

  if (subtreeHasEffect || rootHasEffect) {
    // beforeMutation
    // mutation
    commitMutationEffects(finishedWork, root);
    // wip树的切换
    root.current = finishedWork;
    // layout
    commitLayoutEffects(finishedWork, root);
  } else {
    root.current = finishedWork;
  }
  rootDoseHasPassiveEffect = false;
  ensureRootIsScheduled(root);
}
