/**
 * @file src/App.tsx
 * @description Корневая точка входа клиентского интерфейса AutoApp-Builder,
 *              делегирующая рендеринг модулю `src/renderer/App.tsx`.
 */

import AutoAppBuilderRenderer from './renderer/App.tsx';

export default function App() {
  return <AutoAppBuilderRenderer />;
}
