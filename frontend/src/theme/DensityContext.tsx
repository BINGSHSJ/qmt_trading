import { createContext, useContext } from 'react';
import type { DisplayDensity } from './density';
import { defaultDisplayDensity } from './density';

interface DensityContextValue {
  density: DisplayDensity;
  setDensity: (density: DisplayDensity) => void;
}

export const DensityContext = createContext<DensityContextValue>({
  density: defaultDisplayDensity,
  setDensity: () => undefined,
});

export function useDisplayDensity() {
  return useContext(DensityContext);
}
