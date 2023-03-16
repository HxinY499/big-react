import { Container } from 'hostConfig';
import { Props } from 'shared/ReactTypes';

export const elementPropsKey = '__props';
export enum ValidEventType {
  Click = 'click',
}
const validEventTypeList: ValidEventType[] = [ValidEventType.Click];

type EventCallback = (e: Event) => void;
interface Paths {
  capture: EventCallback[];
  bubble: EventCallback[];
}
interface SyntheticEvent extends Event {
  __stopPropagation: boolean;
}
export interface DOMElement extends Element {
  [elementPropsKey]: Props;
}

export function updateFiberProps(node: DOMElement, props: Props) {
  node[elementPropsKey] = props;
}

export function initEvent(container: Container, eventType: ValidEventType) {
  if (!validEventTypeList.includes(eventType)) {
    console.warn('SyntheticEvent：当前不支持', eventType, '事件');
    return;
  }
  if (__DEV__) {
    console.warn('SyntheticEvent：初始化事件', eventType);
  }

  container.addEventListener(eventType, (e) => {
    dispatchEvent(container, eventType, e);
  });
}

function dispatchEvent(container: Container, eventType: ValidEventType, e: Event) {
  const targetElement = e.target;
  // 1. 收集沿途的事件
  const { bubble, capture } = collectPaths(targetElement as DOMElement, container, eventType);
  // 2. 构造合成事件
  const se = createSyntheticEvent(e);
  // 3. 遍历capture
  triggerEventFlow(capture, se);
  if (!se.__stopPropagation) {
    // 4. 遍历bubble
    triggerEventFlow(bubble, se);
  }
}

function createSyntheticEvent(e: Event): SyntheticEvent {
  const syntheticEvent = e as SyntheticEvent;
  syntheticEvent.__stopPropagation = false;
  const originStopPropagation = e.stopPropagation;

  syntheticEvent.stopPropagation = () => {
    syntheticEvent.__stopPropagation = true;
    if (originStopPropagation) originStopPropagation();
  };

  return syntheticEvent;
}

function triggerEventFlow(paths: EventCallback[], se: SyntheticEvent) {
  for (let i = 0; i < paths.length; i++) {
    const callback = paths[i];
    callback.call(null, se);

    if (se.__stopPropagation) {
      break;
    }
  }
}

function collectPaths(targetElement: DOMElement, container: Container, eventType: ValidEventType) {
  const paths: Paths = {
    capture: [],
    bubble: [],
  };

  while (targetElement && targetElement !== container) {
    // 收集
    const elementProps = targetElement[elementPropsKey];
    if (elementProps) {
      // click => [onClickCapture onClick]
      const callbackNameList = getEventCallbackNameFromEventType(eventType);
      if (callbackNameList) {
        callbackNameList.forEach((callbackName, i) => {
          const eventCallback = elementProps[callbackName];
          if (eventCallback) {
            if (i === 0) {
              paths.capture.unshift(eventCallback);
            } else {
              paths.bubble.push(eventCallback);
            }
          }
        });
      }
    }
    targetElement = targetElement.parentNode as DOMElement;
  }
  return paths;
}

function getEventCallbackNameFromEventType(eventType: ValidEventType): string[] | undefined {
  return {
    click: ['onClickCapture', 'onClick'],
  }[eventType];
}
