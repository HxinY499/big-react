import { Props, Key, Ref, ReactElementType } from 'shared/ReactTypes';
import { FunctionComponent, HostComponent, WorkTag, Fragment } from './workTags';
import { Flags, NoFlags } from './fiberFlags';
import { Container } from 'hostConfig';
import { Lane, Lanes, NoLane, NoLanes } from './fiberLanes';
import { Effect } from './fiberHooks';
import { CallbackNode } from 'scheduler';

export class FiberNode {
  tag: WorkTag;
  pendingProps: Props;
  key: Key;
  stateNode: any;
  type: any;
  ref: Ref;

  return: FiberNode | null;
  sibling: FiberNode | null;
  child: FiberNode | null;
  index: number;

  memorizedProps: Props | null;
  memorizedState: any;
  alternate: FiberNode | null;
  flags: Flags;
  subtreeFlags: Flags;
  updateQueue: unknown;
  deletions: FiberNode[] | null;

  constructor(tag: WorkTag, pendingProps: Props, key: Key) {
    this.tag = tag;
    this.key = key || null;
    this.stateNode = null;
    // 例：Functioncomponent type 就是函数本身
    this.type = null;

    /*
     * 构成树状结构
     */
    // 指向父fiberNode
    this.return = null;
    // 指向右边的兄弟fiberNode
    this.sibling = null;
    // 指向子fiberNode
    this.child = null;
    this.index = 0;

    this.ref = 0;

    /*
     * 作为工作单元
     */
    this.pendingProps = pendingProps;
    this.memorizedProps = null;
    this.updateQueue = null;
    this.memorizedState = null;

    this.alternate = null;
    // 副作用
    this.flags = NoFlags;
    this.subtreeFlags = NoFlags;
    this.deletions = null;
  }
}

export interface PendingPassiveEffects {
  unmount: Effect[];
  update: Effect[];
}

export class FiberRootNode {
  container: Container;
  current: FiberNode;
  finishedWork: FiberNode | null;
  pendingLanes: Lanes;
  finishedLane: Lane;
  pendingPassiveEffects: PendingPassiveEffects;

  callbackNode: CallbackNode | null;
  callbackPriority: Lane;

  constructor(container: Container, hostRootFiber: FiberNode) {
    this.container = container;
    this.current = hostRootFiber;
    hostRootFiber.stateNode = this;
    this.finishedWork = null;
    this.pendingLanes = NoLanes;
    this.finishedLane = NoLane;
    this.pendingPassiveEffects = {
      unmount: [],
      update: [],
    };

    this.callbackNode = null;
    this.callbackPriority = NoLane;
  }
}

export function createWorkInProgress(current: FiberNode, pendingProps: Props): FiberNode {
  let wip = current.alternate;

  if (wip === null) {
    // mount
    wip = new FiberNode(current.tag, pendingProps, current.key);
    wip.type = current.type;
    wip.stateNode = current.stateNode;

    wip.alternate = current;
    current.alternate = wip;
  } else {
    // update
    wip.pendingProps = pendingProps;
    wip.flags = NoFlags;
    wip.type = current.type;
    wip.deletions = null;
  }
  wip.flags = current.flags;
  wip.child = current.child;
  wip.updateQueue = current.updateQueue;
  wip.memorizedProps = current.memorizedProps;
  wip.memorizedState = current.memorizedState;
  return wip;
}

export function createFiberFromElement(element: ReactElementType) {
  const { type, key, props, ref } = element;
  let fiberTag: WorkTag = FunctionComponent;

  if (typeof type === 'string') {
    fiberTag = HostComponent;
  } else if (typeof type !== 'function' && __DEV__) {
    console.warn('未定义的type类型', element);
  }
  const fiber = new FiberNode(fiberTag, props, key);
  fiber.type = type;
  fiber.ref = ref;
  return fiber;
}

export function createFiberFromFragment(elements: any[], key: Key): FiberNode {
  const fiber = new FiberNode(Fragment, elements, key);
  return fiber;
}
