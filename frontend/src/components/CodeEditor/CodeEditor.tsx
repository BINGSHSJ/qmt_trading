import Editor, { loader, type Monaco } from '@monaco-editor/react';
import * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api.js';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import { localQuantCodeEditorThemes } from '../../theme/codeEditorTheme';
import { useThemeMode } from '../../theme/ThemeModeContext';

window.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

loader.config({ monaco: monacoEditor });

interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  height?: string | number;
}

export default function CodeEditor({ value, onChange, readOnly = false, height = '520px' }: CodeEditorProps) {
  const { mode } = useThemeMode();

  return (
    <Editor
      height={height}
      language="python"
      theme={mode === 'light' ? 'lqc-ibkr-light' : 'lqc-ibkr-dark'}
      value={value}
      loading={<div className="code-editor-loading" data-testid="code-editor-loading">正在加载代码编辑器...</div>}
      beforeMount={defineLqcTheme}
      onChange={(next) => {
        if (!readOnly) onChange?.(next ?? '');
      }}
      options={{
        readOnly,
        domReadOnly: readOnly,
        minimap: { enabled: false },
        fontSize: 13,
        tabSize: 4,
        wordWrap: 'on',
        scrollBeyondLastLine: false,
        lineNumbersMinChars: 3,
        overviewRulerBorder: false,
        renderLineHighlight: 'gutter',
      }}
    />
  );
}

function defineLqcTheme(monaco: Monaco) {
  monaco.editor.defineTheme('lqc-ibkr-dark', localQuantCodeEditorThemes['lqc-ibkr-dark']);
  monaco.editor.defineTheme('lqc-ibkr-light', localQuantCodeEditorThemes['lqc-ibkr-light']);
}
