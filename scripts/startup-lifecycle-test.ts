/**
 * Startup lifecycle regression tests.
 *
 * The startup flicker was not a performance problem, it was a continuity
 * problem: 450 visible cards each had imageAlpha slammed to 0 the instant the
 * full atlas decoded, so the whole grid dropped to transparent and faded back
 * in. These assert the properties that prevent that class of bug returning.
 *
 * Run: npx tsx scripts/startup-lifecycle-test.ts
 */
import * as fs from 'fs'
import * as path from 'path'

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf8')
const pool = read('src/components/canvas/useSpritePool.ts')
const atlas = read('src/components/canvas/atlas.ts')
const canvas = read('src/components/canvas/PixiCanvas.tsx')

let passed = 0
const failures: string[] = []
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) passed++
  else failures.push(`${name}${detail ? ' — ' + detail : ''}`)
}

// --- the actual bug -------------------------------------------------------
{
  // An upgrade must never restart the fade. acquireCard already zeroes alpha
  // for genuinely new cards, so any other assignment is a regression.
  const assignBlock = pool.slice(pool.indexOf('if (isNewTexture)'), pool.indexOf('// Animate image fade-in'))
  check('no alpha reset inside the texture-assignment block',
    !/imageAlpha\s*=\s*0/.test(assignBlock), 'a texture upgrade would re-fade the whole grid')
  check('new cards still start transparent so they fade in once',
    /card\.imageAlpha = 0/.test(pool.slice(pool.indexOf('const acquireCard'), pool.indexOf('const releaseCard'))))
}

// --- preview must survive the full atlas ---------------------------------
{
  const destroyBlock = atlas.slice(atlas.indexOf('const destroy ='), atlas.indexOf('const stats ='))
  check('preview textures are only destroyed on teardown',
    destroyBlock.includes('destroyed = true'))
  check('loading the full atlas never destroys the preview',
    !/preview\s*=\s*null/.test(atlas.slice(atlas.indexOf('const load ='), atlas.indexOf('const get ='))))
  // A failed load resolves to null and the callback bails, so `preview` keeps
  // serving every slot rather than the grid going blank.
  check('a failed full atlas leaves preview serving',
    atlas.includes('return null') && atlas.includes('if (!a || destroyed) return'))
  check('get() falls back to preview whenever full is absent',
    /if \(f\) return frameFor\(f, inAtlas\)\s*\n\s*if \(preview\) return frameFor\(preview, slot\)/.test(atlas))
}

// --- GPU upload must not land inside a visible frame ---------------------
{
  check('atlas exposes an explicit GPU pre-upload', atlas.includes('warmGpu'))
  // Order matters, not formatting: within the promotion path the upload must
  // precede the render that first shows the new atlas.
  const promote = canvas.slice(canvas.indexOf('const promote = ()'), canvas.indexOf('// The preview is what makes'))
  check('pre-upload runs before the render that reveals it',
    promote.indexOf('atlas.warmGpu') > -1 &&
    promote.indexOf('atlas.warmGpu') < promote.indexOf('render(true)'))
  check('the full-atlas upgrade waits for an idle main thread',
    canvas.includes('requestIdleCallback') && /level === 'preview'/.test(canvas),
    'a 110ms GPU upload must not land mid-gesture')
  check('upload is idempotent so repeated readiness cannot re-upload',
    atlas.includes('warmed.has(a)') && atlas.includes('warmed.add(a)'))
}

// --- canvas identity ------------------------------------------------------
{
  const initEffect = canvas.slice(canvas.indexOf('// Initialize PixiJS'), canvas.indexOf('// Textures now finish') > 0 ? canvas.indexOf('// Textures now finish') : canvas.length)
  check('Pixi init effect has no reactive dependencies',
    /\}, \[\]\) \/\/ eslint-disable-line/.test(initEffect), 'atlas or state changes would remount the canvas')
  check('atlas store is not React state',
    !/useState[^\n]*atlas/i.test(canvas) && canvas.includes('useMemo(() => createAtlasStore(), [])'))
  check('atlas readiness repaints rather than re-renders React',
    canvas.includes('render(true)') && !/setAtlasReady|useState\(.*atlas/i.test(canvas))
}

// --- monotonic quality ----------------------------------------------------
{
  check('mid-res is never downgraded back to thumb',
    pool.includes('card.hasMid && midTexture'))
  check('atlas level upgrade keeps the same logical url',
    pool.includes('const thumbUrl = getThumbUrl(concept)'))
}

// --- telemetry contract ---------------------------------------------------
{
  const tel = read('src/components/canvas/startup-telemetry.ts')
  for (const k of ['blankFramesAfterFirstPixels', 'startupVisualResets', 'canvasRemounts', 'rendererResizes']) {
    check(`telemetry tracks ${k}`, tel.includes(k))
  }
  check('a blank frame after first pixels counts as a reset',
    tel.includes("this.reset('blankFrame'"))
  check('a collapse in drawn cards counts as a reset',
    tel.includes("this.reset('drawnCollapse'"))
}

console.log(`\n  ${passed} passed, ${failures.length} failed\n`)
for (const f of failures) console.log(`    FAIL  ${f}`)
if (failures.length) process.exit(1)
console.log('  PASS - startup lifecycle invariants hold\n')
