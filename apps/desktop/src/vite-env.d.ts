/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TASK_MANAGER_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
