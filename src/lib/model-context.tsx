import { createContext, useContext, useState } from 'react';

const MODEL_STORAGE_KEY = 'miniclue:selected-model';

type ModelContextValue = {
  selectedModel: string | null;
  setSelectedModel: (model: string) => void;
};

const ModelContext = createContext<ModelContextValue | null>(null);

export function ModelProvider({ children }: { children: React.ReactNode }) {
  const [selectedModel, setSelectedModelState] = useState<string | null>(() => {
    return localStorage.getItem(MODEL_STORAGE_KEY) ?? null;
  });

  const setSelectedModel = (model: string) => {
    localStorage.setItem(MODEL_STORAGE_KEY, model);
    setSelectedModelState(model);
  };

  return (
    <ModelContext.Provider value={{ selectedModel, setSelectedModel }}>
      {children}
    </ModelContext.Provider>
  );
}

export function useSelectedModel() {
  const ctx = useContext(ModelContext);
  if (!ctx)
    throw new Error('useSelectedModel must be used within ModelProvider');
  return ctx;
}
