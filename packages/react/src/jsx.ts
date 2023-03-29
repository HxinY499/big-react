import { REACT_ELEMENT_TYPE, REACT_FRAGMENT_TYPE } from 'shared/ReactSymbols';
import { ReactElementType, Type, Key, Ref, Props, ElementType } from 'shared/ReactTypes';

const ReactElement = (type: ElementType, key: Key, ref: Ref, props: Props): ReactElementType => {
  const element: ReactElementType = {
    $$typeof: REACT_ELEMENT_TYPE,
    type,
    key,
    ref,
    props,
    __mark: 'HxinY',
  };
  return element;
};

export const jsx = (type: ElementType, config: any, ...maybeChildren: any) => {
  let key: Key = null;
  const props: Props = {};
  let ref: Ref = null;

  for (const prop in config) {
    const val = config[prop];
    if (prop === 'key') {
      if (val || val === null) key = '' + val;
      continue;
    }
    if (prop === 'ref') {
      if (val) ref = val;
      continue;
    }
    if (Object.hasOwnProperty.call(config, prop)) {
      props[prop] = val;
    }
  }

  const maybeChildrenLength = maybeChildren.length;
  if (maybeChildrenLength === 1) {
    props.children = maybeChildren[0];
  } else if (maybeChildrenLength > 1) {
    props.children = maybeChildren;
  }

  return ReactElement(type, key, ref, props);
};

export const jsxDEV = (type: ElementType, config: any) => {
  let key: Key = null;
  const props: Props = {};
  let ref: Ref = null;

  for (const prop in config) {
    const val = config[prop];
    if (prop === 'key') {
      if (val || val === null) key = '' + val;
      continue;
    }
    if (prop === 'ref') {
      if (val) ref = val;
      continue;
    }
    if (Object.hasOwnProperty.call(config, prop)) {
      props[prop] = val;
    }
  }

  return ReactElement(type, key, ref, props);
};

export const Fragment = REACT_FRAGMENT_TYPE;

export function isValidElement(object: any) {
  return typeof object === 'object' && object !== null && object.$$typeof === REACT_ELEMENT_TYPE;
}
