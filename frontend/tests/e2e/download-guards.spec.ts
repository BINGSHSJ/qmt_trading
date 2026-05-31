import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, test } from '@playwright/test';

const sourceRoot = join(process.cwd(), 'src');
const downloadImplementationFile = 'src/services/request.ts';

function sourceFiles(root: string): string[] {
  return readdirSync(root)
    .flatMap((entry) => {
      const path = join(root, entry);
      if (statSync(path).isDirectory()) {
        return sourceFiles(path);
      }
      return /\.(ts|tsx)$/.test(entry) ? [path] : [];
    });
}

function normalize(path: string) {
  return relative(process.cwd(), path).replaceAll('\\', '/');
}

test('文件下载入口必须复用统一 downloadFile 错误处理', () => {
  const files = sourceFiles(sourceRoot).map((file) => ({
    path: normalize(file),
    content: readFileSync(file, 'utf-8'),
  }));

  const customDownloadImplementations = files
    .filter((file) => file.path !== downloadImplementationFile)
    .filter((file) => (
      file.content.includes('createObjectURL')
      || file.content.includes("document.createElement('a')")
      || file.content.includes('document.createElement("a")')
      || /\.download\s*=/.test(file.content)
    ))
    .map((file) => file.path);

  expect(
    customDownloadImplementations,
    '业务页面或服务不得自行实现浏览器下载；请统一调用 src/services/request.ts 的 downloadFile，以保留中文错误、技术详情和 trace_id。',
  ).toEqual([]);

  const directExportEndpointFiles = files
    .filter((file) => /['"`][^'"`]*(?:\/export|missing-export)/.test(file.content))
    .filter((file) => !file.path.startsWith('src/services/'))
    .map((file) => file.path);

  expect(
    directExportEndpointFiles,
    '业务页面不得直接拼接导出接口；请在 src/services/* 中封装并复用 downloadFile。',
  ).toEqual([]);

  const exportServiceFilesWithoutDownloadFile = files
    .filter((file) => file.path.startsWith('src/services/'))
    .filter((file) => /['"`][^'"`]*(?:\/export|missing-export)/.test(file.content))
    .filter((file) => !file.content.includes('downloadFile('))
    .map((file) => file.path);

  expect(
    exportServiceFilesWithoutDownloadFile,
    '导出服务必须调用 downloadFile，不能用 request/fetch 处理文件下载。',
  ).toEqual([]);
});
