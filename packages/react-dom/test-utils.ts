// @ts-ignore
import { createRoot } from 'react-dom';
import { ReactElementType } from 'shared/ReactTypes';

export function renderIntoDocument(element: ReactElementType) {
  const div = document.createElement('div');
  return createRoot(div).render(element);
}
