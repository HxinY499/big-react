import { Dispatch } from 'react/src/currentDispatcher';
import { Action } from 'shared/ReactTypes';

export interface Update<State> {
  action: Action<State>;
}

export interface UpdateQueue<State> {
  shared: {
    pending: Update<State> | null;
  };
  dispatch: Dispatch<State> | null;
}

export const createUpdate = <T>(action: Action<T>): Update<T> => {
  return { action };
};

export const createUpdateQueue = <T>(): UpdateQueue<T> => {
  return { shared: { pending: null }, dispatch: null };
};

export const enqueueUpdate = <T>(updateQueue: UpdateQueue<T>, update: Update<T>) => {
  updateQueue.shared.pending = update;
};

export const processUpdateQueue = <State>(
  baseState: State,
  pendingUpdate: Update<State> | null
): { memorizedState: State } => {
  const result: ReturnType<typeof processUpdateQueue<State>> = {
    memorizedState: baseState,
  };

  if (pendingUpdate !== null) {
    const action = pendingUpdate.action;

    if (action instanceof Function) {
      // baseState 1 update (x) => 4x -> memorizedState 4
      result.memorizedState = action(baseState);
    } else {
      // baseState 1 update 2 -> memorizedState 2
      result.memorizedState = action;
    }
  }

  return result;
};
