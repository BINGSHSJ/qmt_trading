import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

export function useUrlSyncedTab<T extends string>(validTabs: readonly T[], defaultTab: T, paramName = 'tab') {
  const [searchParams, setSearchParams] = useSearchParams();

  const rawVal = searchParams.get(paramName);
  const activeTab = validTabs.includes(rawVal as T) ? (rawVal as T) : defaultTab;

  const setActiveTab = useCallback(
    (nextTab: T) => {
      setSearchParams((previous) => {
        const nextParams = new URLSearchParams(previous);
        if (nextTab === defaultTab) {
          nextParams.delete(paramName);
        } else {
          nextParams.set(paramName, nextTab);
        }
        return nextParams;
      }, { replace: true });
    },
    [defaultTab, paramName, setSearchParams],
  );

  return [activeTab, setActiveTab] as const;
}
