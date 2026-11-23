const FILE_HEADER = 'diff --git '

function sectionNamesPath(section: string, path: string): boolean {
  const hunkStart = section.indexOf('\n@@')
  const header = (hunkStart === -1 ? section : section.slice(0, hunkStart)).split('\n')
  return header.some(
    (line, index) =>
      (index === 0 && line.endsWith(` b/${path}`)) ||
      line === `+++ b/${path}` ||
      line === `--- a/${path}` ||
      line === `rename to ${path}` ||
      line === `rename from ${path}`
  )
}

/** The part of a git-format diff that changes `path`; empty when no file section names it. */
export function selectDiffFileSection(diff: string, path: string): string {
  const wanted = path.replace(/^\.?\/+/, '')
  return diff
    .split(/^(?=diff --git )/m)
    .filter((section) => section.startsWith(FILE_HEADER) && sectionNamesPath(section, wanted))
    .join('')
}
