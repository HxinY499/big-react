import { Dispatch } from 'react/src/currentDispatcher';
import internals from 'shared/internals';
import { Action } from 'shared/ReactTypes';
import { FiberNode } from './fiber';
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

const { currentDispatcher } = internals;

interface Hook {
  memorizedState: any;
  updateQueue: unknown;
  next: Hook | null;
}

export function renderWithHooks(wip: FiberNode) {
  currentlyRenderingFiber = wip;
  // 重置，函数组件fiber中memorizedState指向hooks链表
  wip.memorizedState = null;

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
  return children;
}

const HooksDispatcherOnMount = {
  useState: mountState,
};
const HooksDispatcherOnUpdate = {
  useState: updateState,
};

function mountState<State>(initialState: (() => State) | State): [State, Dispatch<State>] {
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

  // @ts-ignore
  const dispatch = dispatchSetState.bind(null, currentlyRenderingFiber, queue);
  queue.dispatch = dispatch;

  return [memorizedState, dispatch];
}

function updateState<State>(initialState: (() => State) | State): [State, Dispatch<State>] {
  // 找到当前useState对应的hook数据
  const hook = updateWorkInProgressHook();

  // 计算新state的逻辑
  const queue = hook.updateQueue as UpdateQueue<State>;
  const pending = queue.shared.pending;

  if (pending !== null) {
    const { memorizedState } = processUpdateQueue(hook.memorizedState, pending);
    hook.memorizedState = memorizedState;
  }

  return [hook.memorizedState, queue.dispatch as Dispatch<State>];
}

function dispatchSetState<State>(
  fiber: FiberNode,
  updateQueue: UpdateQueue<State>,
  action: Action<State>
) {
  const update = createUpdate(action);
  enqueueUpdate(updateQueue, update);
  scheduleUpdateOnFiber(fiber);
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
