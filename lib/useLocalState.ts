'use client';

import { useCallback, useEffect, useState } from 'react';
import { LocalState } from './types';
import { defaultLocalState, loadLocalState, saveLocalState } from './localState';

export function useLocalState() {
  const [state, setState] = useState<LocalState>(() => defaultLocalState());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadLocalState().then((loadedState) => {
      setState(loadedState);
      setLoaded(true);
    });
  }, []);

  const updateState = useCallback((updater: (state: LocalState) => LocalState) => {
    setState((prev) => {
      const next = updater(prev);
      saveLocalState(next);
      return next;
    });
  }, []);

  return { state, setState, updateState, loaded };
}
