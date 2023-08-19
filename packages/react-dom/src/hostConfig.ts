import { FiberNode } from 'react-reconciler/src/fiber';
import { HostText } from 'react-reconciler/src/workTags';
import { DOMElement, updateFiberProps } from './SyntheticEvent';

export type Container = Element;
export type Instance = Element;
export type TextInstance = Text;

export function createInstance(type: string, props: any): Instance {
  const element = document.createElement(type) as unknown;
  updateFiberProps(element as DOMElement, props);
  return element as DOMElement;
}

export function createTextInstance(content: string) {
  return document.createTextNode(content);
}

export function appendInitialChild(parent: Instance | Container, child: Instance): void {
  parent.appendChild(child);
}

export const appendChildToContainer = appendInitialChild;

export function commitTextUpdate(textInstance: TextInstance, content: string) {
  textInstance.textContent = content;
}

export function removeChild(child: Instance | TextInstance, container: Container) {
  container.removeChild(child);
}

export function inserChildToContainer(child: Instance, container: Container, before: Instance) {
  container.insertBefore(child, before);
}

export const scheduleMicroTask =
  typeof queueMicrotask === 'function'
    ? queueMicrotask
    : typeof Promise === 'function'
    ? (callback: (...args: any) => void) => Promise.resolve(null).then(callback)
    : setTimeout;
