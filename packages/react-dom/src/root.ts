import { createContainer, updateContainer } from 'react-reconciler/src/fiberReconciler';
import { ReactElementType } from 'shared/ReactTypes';
import { Container } from './hostConfig';
import { initEvent, ValidEventType } from './SyntheticEvent';

export function createRoot(container: Container) {
  const root = createContainer(container);

  return {
    render(element: ReactElementType) {
      initEvent(container, ValidEventType.Click);
      return updateContainer(element, root);
    },
  };
}
