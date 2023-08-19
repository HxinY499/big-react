import { Dispatch } from 'react/src/currentDispatcher';
import currentBatchConfig from 'react/src/currentBatchConfig';
import internals from 'shared/internals';
import { Action } from 'shared/ReactTypes';
import { FiberNode } from './fiber';
import { Flags, PassiveEffect } from './fiberFlags';
import { Lane, NoLane, requestUpdateLane } from './fiberLanes';
import { HookHasEffect, Passive } from './hookEffectTags';
import {
  createUpdate,
  createUpdateQueue,
  enqueueUpdate,
  processUpdateQueue,
  UpdateQueue,
} from './updateQueue';
import { scheduleUpdateOnFiber } from './workLoop';

let currentlyRenderingFiber: FiberNode | null = null;
let workInProgressHook: Hook | null = null;
let currentHook: Hook | null = null;
let renderLane: Lane = NoLane;

const { currentDispatcher } = internals;

interface Hook {
  memorizedState: any;
  updateQueue: unknown;
  next: Hook | null;
}

export interface Effect {
  tag: Flags;
  create: EffectCallback | void;
  destroy: EffectCallback | void;
  deps: EffectDeps;
  next: Effect | null;
}

type EffectCallback = () => void;
type EffectDeps = any[] | null;

export interface FCUpdateQueue<State> extends UpdateQueue<State> {
  lastEffect: Effect | null;
}

export function renderWithHooks(wip: FiberNode, lane: Lane) {
  currentlyRenderingFiber = wip;
  // 重置，函数组件fiber.memorizedState = hooks链表
  wip.memorizedState = null;
  // 重置，函数组件fiber.memorizedState = effect链表
  wip.updateQueue = null;
  wip.updateQueue = null;
  renderLane = lane;

  const current = wip.alternate;
  if (current !== null) {
    // update
    currentDispatcher.current = HooksDispatcherOnUpdate;
  } else {
    // mount
    currentDispatcher.current = HooksDispatcherOnMount;
  }

  const Component = wip.type;
  const props = wip.pendingProps;
  const children = Component(props);

  // 重置
  currentlyRenderingFiber = null;
  workInProgressHook = null;
  currentHook = null;
  renderLane = NoLane;
  return children;
}

const HooksDispatcherOnMount = {
  useState: mountState,
  useEffect: mountEffect,
  useTransition: mountTransition,
  useRef: mountRef,
};
const HooksDispatcherOnUpdate = {
  useState: updateState,
  useEffect: updateEffect,
  useTransition: updateTransition,
  useRef: updateRef,
};

// ///////////////useState起////////////////////////////////////////////////////////////////////////////////
function mountState<State>(initialState?: (() => State) | State): [State, Dispatch<State>] {
  // 找到当前useState对应的hook数据
  const hook = mountWorkInProgressHook();

  let memorizedState;
  if (initialState instanceof Function) {
    memorizedState = initialState();
  } else {
    memorizedState = initialState;
  }

  const queue = createUpdateQueue<State>();
  hook.updateQueue = queue;
  hook.memorizedState = memorizedState;
  hook.baseState = memorizedState;

  // @ts-ignore
  const dispatch = dispatchSetState.bind(null, currentlyRenderingFiber, queue);
  queue.dispatch = dispatch;

  return [memorizedState!, dispatch];
}

function updateState<State>(initialState?: (() => State) | State): [State, Dispatch<State>] {
  // 找到当前useState对应的hook数据
  const hook = updateWorkInProgressHook();

  // 计算新state的逻辑
  const queue = hook.updateQueue as UpdateQueue<State>;
  const pending = queue.shared.pending;
  queue.shared.pending = null;

  if (pending !== null) {
    const { memorizedState } = processUpdateQueue(hook.memorizedState, pending, renderLane);
    hook.memorizedState = memorizedState;
  }

  return [hook.memorizedState, queue.dispatch as Dispatch<State>];
}

function dispatchSetState<State>(
  fiber: FiberNode,
  updateQueue: UpdateQueue<State>,
  action: Action<State>
) {
  const lane = requestUpdateLane();
  const update = createUpdate(action, lane);
  enqueueUpdate(updateQueue, update);
  scheduleUpdateOnFiber(fiber, lane);
}
// ///////////////useState终////////////////////////////////////////////////////////////////////////////////

// ///////////////useEffect起///////////////////////////////////////////////////////////////////////////////
function mountEffect(create: EffectCallback, deps: EffectDeps) {
  // 找到当前useEffect对应的hook数据
  const hook = mountWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  currentlyRenderingFiber!.flags |= PassiveEffect;

  // useEffect的memorizedState存着该fiberNode中所有的useEffect组成的环状链表
  hook.memorizedState = pushEffect(Passive | HookHasEffect, create, undefined, nextDeps);
}

function updateEffect(create: EffectCallback, deps: EffectDeps) {
  // 找到当前useEffect对应的hook数据
  const hook = updateWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  let destroy: EffectCallback | void;

  if (currentHook !== null) {
    const prevEffect = currentHook.memorizedState as Effect;
    destroy = prevEffect.destroy;

    if (nextDeps !== null) {
      // 浅比较
      const prevDeps = prevEffect.deps;
      if (areHookInputsEqual(nextDeps, prevDeps)) {
        hook.memorizedState = pushEffect(Passive, create, destroy, nextDeps);
        return;
      }
    }
    // 浅比较不相等
    currentlyRenderingFiber!.flags |= PassiveEffect;
    hook.memorizedState = pushEffect(Passive | HookHasEffect, create, destroy, nextDeps);
  }
  currentlyRenderingFiber!.flags |= PassiveEffect;
}

function pushEffect(
  hookFlags: Flags,
  create: EffectCallback | void,
  destroy: EffectCallback | void,
  deps: EffectDeps
): Effect {
  const effect: Effect = {
    tag: hookFlags,
    create,
    destroy,
    deps,
    next: null,
  };
  const fiber = currentlyRenderingFiber as FiberNode;
  const updateQueue = fiber.updateQueue as FCUpdateQueue<any>;
  if (updateQueue === null) {
    fiber.updateQueue = createFCUpdateQueue();
    effect.next = effect;
    (fiber.updateQueue as FCUpdateQueue<any>).lastEffect = effect;
  } else {
    // 插入effect
    const lastEffect = updateQueue.lastEffect;
    if (lastEffect === null) {
      effect.next = effect;
      updateQueue.lastEffect = effect;
    } else {
      const firstEffect = lastEffect.next;
      lastEffect.next = effect;
      effect.next = firstEffect;
      updateQueue.lastEffect = effect;
    }
  }
  return effect;
}
// ///////////////useEffect终///////////////////////////////////////////////////////////////////////////////

// ///////////////useTransition起///////////////////////////////////////////////////////////////////////////
function mountTransition(): [boolean, (callback: () => void) => void] {
  const [isPending, setIsPending] = mountState(false);
  const hook = mountWorkInProgressHook();
  const start = startTransition.bind(null, setIsPending);
  hook.memorizedState = start;
  return [isPending, start];
}
function updateTransition(): [boolean, (callback: () => void) => void] {
  const [isPending] = updateState();
  const hook = updateWorkInProgressHook();
  const start = hook.memorizedState;
  currentBatchConfig;
  return [isPending as boolean, start];
}

function startTransition(setPending: Dispatch<boolean>, callback: () => void) {
  setPending(true);
  const prevTransition = currentBatchConfig.transition;
  currentBatchConfig.transition = 1;

  callback();
  setPending(false);

  currentBatchConfig.transition = prevTransition;
}
// ///////////////useTransition终///////////////////////////////////////////////////////////////////////////

// ///////////////useRef起///////////////////////////////////////////////////////////////////////////
function mountRef<T>(initialValue: T): { current: T } {
  const hook = mountWorkInProgressHook();
  const ref = { current: initialValue };
  hook.memorizedState = ref;
  return ref;
}
function updateRef<T>(initialValue: T): { current: T } {
  const hook = updateWorkInProgressHook();
  return hook.memorizedState;
}
// ///////////////useRef终///////////////////////////////////////////////////////////////////////////
function createFCUpdateQueue<State>() {
  const updateQueue = createUpdateQueue<State>() as FCUpdateQueue<State>;
  updateQueue.lastEffect = null;
  return updateQueue;
}

function mountWorkInProgressHook(): Hook {
  // 作用：新建一个hook
  const hook: Hook = {
    memorizedState: null,
    next: null,
    updateQueue: null,
  };

  if (workInProgressHook === null) {
    // mount时 第一个hook
    if (currentlyRenderingFiber === null) {
      throw new Error('hooks只能在函数组件中使用');
    } else {
      workInProgressHook = hook;
      currentlyRenderingFiber.memorizedState = workInProgressHook;
    }
  } else {
    // mount时 后续的hook
    workInProgressHook.next = hook;
    workInProgressHook = hook;
  }
  return workInProgressHook;
}

function updateWorkInProgressHook(): Hook {
  // 作用：从currentFiber中找到对应hook，根据该hook创建一个新的hook

  // TODO render阶段触发的更新

  let nextCurrentHook: Hook | null;

  if (currentHook === null) {
    // FC update时的第一个hook
    const currentFiber = currentlyRenderingFiber?.alternate;
    if (currentFiber !== null) {
      nextCurrentHook = currentFiber?.memorizedState;
    } else {
      // mount 错误情况，mount不该进入这里
      nextCurrentHook = null;
    }
  } else {
    // FC update时后续的hook
    nextCurrentHook = currentHook.next;
  }

  if (nextCurrentHook === null && currentHook !== null) {
    throw new Error(`组件${currentlyRenderingFiber?.type}本次执行时的Hook比上次执行的Hook多`);
  }

  currentHook = nextCurrentHook as Hook;
  const newHook: Hook = {
    memorizedState: currentHook.memorizedState,
    updateQueue: currentHook.updateQueue,
    next: null,
  };

  if (workInProgressHook === null) {
    //  第一个hook
    if (currentlyRenderingFiber === null) {
      throw new Error('hooks只能在函数组件中使用');
    } else {
      workInProgressHook = newHook;
      currentlyRenderingFiber.memorizedState = workInProgressHook;
    }
  } else {
    // 后续的hook
    workInProgressHook.next = newHook;
    workInProgressHook = newHook;
  }
  return workInProgressHook;
}

function areHookInputsEqual(nextDeps: EffectDeps, prevDeps: EffectDeps) {
  if (nextDeps === null || prevDeps === null) {
    return false;
  }
  for (let i = 0; i < prevDeps.length && i < nextDeps.length; i++) {
    if (Object.is(nextDeps[i], prevDeps[i])) {
      continue;
    }
    return false;
  }

  return true;
}
