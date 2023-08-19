import { Dispatch } from 'react/src/currentDispatcher';
import { Action } from 'shared/ReactTypes';
import { Lane } from './fiberLanes';

export interface Update<State> {
  action: Action<State>;
  next: Update<any> | null;
  lane: Lane;
}

export interface UpdateQueue<State> {
  shared: {
    pending: Update<State> | null;
  };
  dispatch: Dispatch<State> | null;
}

export const createUpdate = <T>(action: Action<T>, lane: Lane): Update<T> => {
  return { action, next: null, lane };
};

export const createUpdateQueue = <T>(): UpdateQueue<T> => {
  return { shared: { pending: null }, dispatch: null };
};

export const enqueueUpdate = <T>(updateQueue: UpdateQueue<T>, update: Update<T>) => {
  const pending = updateQueue.shared.pending;
  if (pending === null) {
    // pending = a -> a
    update.next = update;
  } else {
    // pending = b -> a -> b
    // pending = c -> a -> b -> c
    update.next = pending.next;
    pending.next = update;
  }
  updateQueue.shared.pending = update;
};

export const processUpdateQueue = <State>(
  baseState: State,
  pendingUpdate: Update<State> | null,
  renderLane: Lane
): { memorizedState: State } => {
  const result: ReturnType<typeof processUpdateQueue<State>> = {
    memorizedState: baseState,
  };

  if (pendingUpdate !== null) {
    // 第一个update
    let first = pendingUpdate.next;
    let pending = pendingUpdate.next as Update<any>;
    do {
      const updateLane = pending.lane;
      if (updateLane === renderLane) {
        const action = pendingUpdate.action;
        if (action instanceof Function) {
          // baseState 1 update (x) => 4x -> memorizedState 4
          baseState = action(baseState);
        } else {
          // baseState 1 update 2 -> memorizedState 2
          baseState = action;
        }
      } else {
        if (__DEV__) {
          console.error('processUpdateQueue出错，不该进入updateLane !== renderLane的逻辑');
        }
      }
      pending = pending.next as Update<any>;
    } while (pending !== first);
  }
  result.memorizedState = baseState;
  return result;
};
