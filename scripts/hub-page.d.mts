export function galleryHtml(dir: string, group: string, perRow?: number): string;
export function render(template: string, opts: { tag: string; repo: string; screenshotsDir: string }): string;
export function missingDownloads(page: string, opts: { tag: string; repo: string; files: string[] }): string[];
