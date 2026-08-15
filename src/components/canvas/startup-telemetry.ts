'use client'

/**
 * Startup telemetry.
 *
 * The metric that matters is not milliseconds, it is continuity: once the user
 * sees grid pixels, nothing may flash, blank, reset or regress. Averages hide
 * exactly that, so this records discrete events and counts every visual
 * regression rather than sampling.
 *
 * Read it from the console with window.__cyaPerf().startup.
 */

export type Mark =
  | 'previewFetchStart' | 'previewFetched' | 'previewDecoded' | 'previewGpuReady' | 'firstPreviewFrame'
  | 'pixiInitStart' | 'pixiReady' | 'canvasInserted' | 'firstPixiFrame'
  | 'fullFetchStart' | 'fullFetched' | 'fullDecoded' | 'fullGpuReady'
  | 'fullSwapStart' | 'fullSwapEnd' | 'interactiveAt'

interface FrameStats {
  worstMs: number
  over32: number
  over50: number
  over100: number
  durations: number[]
}

class StartupTelemetry {
  marks: Partial<Record<Mark, number>> = {}
  counters = {
    canvasRemounts: 0,
    rendererResizes: 0,
    spriteTextureSwaps: 0,
    cardAlphaResets: 0,
    blankFramesAfterFirstPixels: 0,
    startupVisualResets: 0,
    textureDestroys: 0,
  }
  longTasks: Array<{ startMs: number; durationMs: number }> = []
  frames: FrameStats = { worstMs: 0, over32: 0, over50: 0, over100: 0, durations: [] }
  resets: Array<{ atMs: number; reason: string; detail?: string }> = []

  /** Highest card count drawn so far; a drop is a visual regression. */
  private peakDrawn = 0
  private sawFirstPixels = false
  private observing = false

  mark(m: Mark) {
    if (this.marks[m] === undefined) this.marks[m] = Math.round(performance.now())
  }

  count(k: keyof StartupTelemetry['counters'], n = 1) {
    this.counters[k] += n
  }

  /** Any regression after the first useful pixels. */
  reset(reason: string, detail?: string) {
    if (!this.sawFirstPixels) return
    this.counters.startupVisualResets++
    if (this.resets.length < 40) {
      this.resets.push({ atMs: Math.round(performance.now()), reason, detail })
    }
  }

  /**
   * Called once per rendered frame with how many cards actually drew an image.
   * A frame that draws nothing after we have already shown pixels is exactly
   * the blank flash we are hunting.
   */
  frame(drawnWithTexture: number, visibleCards: number) {
    if (drawnWithTexture > 0 && !this.sawFirstPixels) {
      this.sawFirstPixels = true
      this.mark('firstPreviewFrame')
    }
    if (this.sawFirstPixels) {
      if (drawnWithTexture === 0 && visibleCards > 0) {
        this.counters.blankFramesAfterFirstPixels++
        this.reset('blankFrame', `${visibleCards} cards visible, 0 textured`)
      } else if (this.peakDrawn > 4 && drawnWithTexture < this.peakDrawn * 0.5) {
        // Losing more than half the drawn cards is a collapse, not a pan.
        this.reset('drawnCollapse', `${this.peakDrawn} -> ${drawnWithTexture}`)
      }
    }
    this.peakDrawn = Math.max(this.peakDrawn, drawnWithTexture)
  }

  /** Frame pacing + long tasks. Only runs for the first few seconds. */
  observe() {
    if (this.observing || typeof window === 'undefined') return
    this.observing = true

    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) {
          if (this.longTasks.length < 50) {
            this.longTasks.push({ startMs: Math.round(e.startTime), durationMs: Math.round(e.duration) })
          }
        }
      }).observe({ type: 'longtask', buffered: true })
    } catch { /* not supported everywhere */ }

    let last = performance.now()
    const tick = () => {
      const now = performance.now()
      const d = now - last
      last = now
      if (now < 8000) {
        this.frames.durations.push(d)
        if (d > this.frames.worstMs) this.frames.worstMs = d
        if (d > 32) this.frames.over32++
        if (d > 50) this.frames.over50++
        if (d > 100) this.frames.over100++
        requestAnimationFrame(tick)
      }
    }
    requestAnimationFrame(tick)
  }

  snapshot() {
    const d = [...this.frames.durations].sort((a, b) => a - b)
    const at = (p: number) => (d.length ? Math.round(d[Math.floor((d.length - 1) * p)]) : 0)
    return {
      navigationStart: 0,
      ...this.marks,
      ...this.counters,
      worstFrameMs: Math.round(this.frames.worstMs),
      p95FrameMs: at(0.95),
      p99FrameMs: at(0.99),
      framesOver32ms: this.frames.over32,
      framesOver50ms: this.frames.over50,
      framesOver100ms: this.frames.over100,
      longestLongTaskMs: this.longTasks.reduce((a, t) => Math.max(a, t.durationMs), 0),
      longTasks: this.longTasks.slice(0, 12),
      resets: this.resets,
    }
  }
}

export const telemetry = new StartupTelemetry()
