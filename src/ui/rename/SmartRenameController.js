/**
 * SmartRenameController — “应用智能改名”按钮背后的业务逻辑（框架无关）
 *
 * 流程：选中一批已分类图片 → 读 EXIF（日期 + GPS）→ 解析语义地点/城市 →
 *       按模板生成命名预览（去重）→ 用户确认 → 经注入的 renamer 实际改名。
 *
 * 依赖（注入）：
 *   - exifService:  ExifService 实例（read(input) -> { coords, takenAt }）
 *   - locationService: SemanticLocationService 实例（resolveLabel(coords)）
 *   - renameService: SmartRenameService 实例（buildBatch(photos)）
 *   - renamer: { rename(oldPath, newName) => Promise<void> }  ← 平台文件操作
 *
 * 视图通过 subscribe 订阅 state，调用 preview()/apply()。
 */

export class SmartRenameController {
  constructor({ exifService, locationService, renameService, renamer }) {
    if (!exifService || !locationService || !renameService) {
      throw new Error('SmartRenameController: exifService / locationService / renameService required');
    }
    this.exifService = exifService;
    this.locationService = locationService;
    this.renameService = renameService;
    this.renamer = renamer || null;

    this._listeners = new Set();
    this.state = {
      status: 'idle', // idle | previewing | ready | applying | done | error
      error: null,
      plan: [], // [{ id, path, originalName, newName, changed, source }]
      applied: 0,
      failed: 0,
    };
  }

  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  getState() {
    return this.state;
  }

  _set(patch) {
    this.state = { ...this.state, ...patch };
    for (const l of this._listeners) l(this.state);
  }

  /**
   * 生成命名预览（不改任何文件）。
   * @param {Array} photos - 每项：{ id?, path, originalName?, contentCategory, input?, coords?, takenAt? }
   *   - input：传给 exifService.read 的对象（Buffer/路径/Blob）；若已有 coords/takenAt 可直接给，跳过读取
   * @param {Object} [opts] - { template?, taken?: Set<string> }
   */
  async preview(photos, opts = {}) {
    this._set({ status: 'previewing', error: null });
    try {
      const enriched = [];
      for (const p of photos) {
        let coords = p.coords || null;
        let takenAt = p.takenAt || null;
        if ((!coords || !takenAt) && p.input != null && this.exifService.available) {
          const ex = await this.exifService.read(p.input);
          coords = coords || ex.coords;
          takenAt = takenAt || ex.takenAt;
        }
        const loc = await this.locationService.resolveLabel(coords || {});
        enriched.push({
          id: p.id,
          path: p.path,
          originalName: p.originalName,
          contentCategory: p.contentCategory,
          takenAt,
          city: loc.label,
          _source: loc.source,
        });
      }

      const named = this.renameService.buildBatch(enriched, {
        template: opts.template,
        taken: opts.taken,
      });

      const plan = named.map((n, i) => ({
        id: enriched[i].id,
        path: enriched[i].path,
        originalName: n.originalName,
        newName: n.newName,
        changed: n.changed,
        source: enriched[i]._source,
      }));

      this._set({ status: 'ready', plan, applied: 0, failed: 0 });
      return plan;
    } catch (err) {
      this._set({ status: 'error', error: err.message });
      throw err;
    }
  }

  /**
   * 应用改名计划（仅对 changed 项；逐个调用注入的 renamer）。
   * @param {Object} [opts] - { onProgress?: (p:{done,total,current})=>void }
   */
  async apply(opts = {}) {
    if (!this.renamer || typeof this.renamer.rename !== 'function') {
      const e = 'SmartRenameController.apply: renamer with rename(oldPath,newName) required';
      this._set({ status: 'error', error: e });
      throw new Error(e);
    }
    const onProgress = opts.onProgress || (() => {});
    const targets = this.state.plan.filter((x) => x.changed);
    this._set({ status: 'applying', applied: 0, failed: 0 });

    let applied = 0;
    let failed = 0;
    const results = [];
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      try {
        await this.renamer.rename(t.path, t.newName);
        applied++;
        results.push({ id: t.id, ok: true, newName: t.newName });
      } catch (err) {
        failed++;
        results.push({ id: t.id, ok: false, error: err.message });
      }
      onProgress({ done: i + 1, total: targets.length, current: t.newName });
      this._set({ applied, failed });
    }

    this._set({ status: 'done' });
    return { applied, failed, results };
  }

  reset() {
    this._set({ status: 'idle', error: null, plan: [], applied: 0, failed: 0 });
  }
}

export default SmartRenameController;
