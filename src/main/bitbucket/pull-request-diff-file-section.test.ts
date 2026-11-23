import { describe, expect, it } from 'vitest'
import { selectDiffFileSection } from './pull-request-diff-file-section'

const README = `diff --git a/README.md b/README.md
index 1111111..2222222 100644
--- a/README.md
+++ b/README.md
@@ -1 +1 @@
-old
+diff --git a/src/server.ts b/src/server.ts
`

const SERVER = `diff --git a/src/server.ts b/src/server.ts
index 3333333..4444444 100644
--- a/src/server.ts
+++ b/src/server.ts
@@ -10,2 +10,2 @@
-close()
+end()
`

const RENAMED = `diff --git a/src/old-name.ts b/src/new-name.ts
similarity index 100%
rename from src/old-name.ts
rename to src/new-name.ts
`

const DELETED = `diff --git a/docs/gone.md b/docs/gone.md
deleted file mode 100644
--- a/docs/gone.md
+++ /dev/null
@@ -1 +0,0 @@
-bye
`

const DIFF = README + SERVER + RENAMED + DELETED

describe('selectDiffFileSection', () => {
  it('returns exactly the section of the named file', () => {
    expect(selectDiffFileSection(DIFF, 'src/server.ts')).toBe(SERVER)
    expect(selectDiffFileSection(DIFF, './README.md')).toBe(README)
  })

  it('finds a renamed file by either name and a deleted file by its old one', () => {
    expect(selectDiffFileSection(DIFF, 'src/old-name.ts')).toBe(RENAMED)
    expect(selectDiffFileSection(DIFF, 'src/new-name.ts')).toBe(RENAMED)
    expect(selectDiffFileSection(DIFF, 'docs/gone.md')).toBe(DELETED)
  })

  it('does not match a path suffix or a header quoted inside a hunk', () => {
    expect(selectDiffFileSection(DIFF, 'server.ts')).toBe('')
    expect(selectDiffFileSection(README, 'src/server.ts')).toBe('')
  })
})
