const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'dashboard-publish.js'), 'utf8');

function makeElement(document, id = '') {
  let html = '';
  const node = {
    id, style: {}, className: '', textContent: '', value: '', checked: false,
    children: [],
    appendChild(child) {
      this.children.push(child);
      if (child.id) document.nodes.set(child.id, child);
    },
    setAttribute() {},
  };
  Object.defineProperty(node, 'innerHTML', {
    get() { return html; },
    set(value) {
      html = String(value);
      const ids = [...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]);
      ids.forEach((childId) => {
        if (!document.nodes.has(childId)) document.nodes.set(childId, makeElement(document, childId));
      });
      const values = [...html.matchAll(/id="([^"]+)"[^>]*value="([^"]*)"/g)];
      values.forEach((match) => { document.nodes.get(match[1]).value = match[2]; });
      const orgs = [...html.matchAll(/name="publishOrg" value="([^"]+)"/g)];
      if (orgs.length) document.orgInputs = orgs.map((match) => {
        const input = makeElement(document);
        input.value = match[1];
        return input;
      });
    },
  });
  return node;
}

function createDocument() {
  const document = {
    nodes: new Map(),
    orgInputs: [],
    createElement() { return makeElement(document); },
    getElementById(id) { return this.nodes.get(id) || null; },
    querySelectorAll(selector) {
      if (selector === 'input[name="publishOrg"]:checked') {
        return this.orgInputs.filter((input) => input.checked);
      }
      return [];
    },
  };
  const panel = makeElement(document, 'data-panel');
  document.nodes.set('data-panel', panel);
  return document;
}

function response(status, body) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

function createContext({ localRole = null, meRole = 'public', meFails = false, shareMode = false } = {}) {
  const document = createDocument();
  const storage = new Map();
  if (localRole) {
    storage.set('diagnosis-role', localRole);
    storage.set('diagnosis-user', localRole + '-user');
    storage.set('diagnosis-branches', localRole === 'admin' ? '*' : 'ORG_A');
  }
  const state = {
    versions: [],
    links: [],
    organizations: [
      { orgId: 'ORG_A', name: 'A分公司' },
      { orgId: 'ORG_B', name: 'B分公司' },
    ],
    tokens: new Map(),
    nextValidationFails: false,
    nextApiError: false,
    fetches: [],
    draftPayload: null,
  };
  let tokenCounter = 0;

  function fetch(url, options = {}) {
    state.fetches.push({ url, options });
    if (url === '/api/me') {
      if (meFails) return response(500, { detail: '身份识别失败' });
      return response(200, { userId: meRole === 'public' ? null : meRole + '-user', role: meRole, branches: meRole === 'admin' ? ['*'] : ['ORG_A'] });
    }
    if (state.nextApiError) {
      state.nextApiError = false;
      return response(500, { detail: '模拟服务错误' });
    }
    const method = options.method || 'GET';
    if (url === '/api/data-versions' && method === 'GET') return response(200, state.versions);
    if (url === '/api/share-links' && method === 'GET') {
      return response(200, state.links.map(({ token, ...link }) => link));
    }
    if (url === '/api/organizations?type=branch') return response(200, state.organizations);
    if (url === '/api/data-versions' && method === 'POST') {
      const body = JSON.parse(options.body);
      state.draftPayload = body;
      const version = {
        id: `data_${state.versions.length + 1}`, period: body.period, status: 'draft',
        payloadSize: JSON.stringify(body.payload).length, createdAt: '2026-06-20T08:00:00Z',
        validatedAt: null, publishedAt: null, validationReport: null,
      };
      state.versions.unshift(version);
      return response(200, version);
    }
    const validateMatch = url.match(/^\/api\/data-versions\/([^/]+)\/validate$/);
    if (validateMatch && method === 'POST') {
      const version = state.versions.find((item) => item.id === validateMatch[1]);
      if (state.nextValidationFails) {
        state.nextValidationFails = false;
        return response(422, { detail: {
          message: '数据版本校验失败', passed: false,
          errors: ['branches 不能为空'], warnings: ['缺少 regions'], branchCount: 0,
        } });
      }
      version.status = 'validated';
      version.validatedAt = '2026-06-20T09:00:00Z';
      version.validationReport = { passed: true, errors: [], warnings: [], branchCount: 1 };
      return response(200, version);
    }
    const publishMatch = url.match(/^\/api\/data-versions\/([^/]+)\/publish$/);
    if (publishMatch && method === 'POST') {
      const version = state.versions.find((item) => item.id === publishMatch[1]);
      if (!version || version.status !== 'validated') return response(409, { detail: '仅 validated 状态可以发布' });
      version.status = 'published';
      version.publishedAt = '2026-06-20T10:00:00Z';
      return response(200, version);
    }
    if (url === '/api/share-links' && method === 'POST') {
      const body = JSON.parse(options.body);
      const token = `token-${++tokenCounter}`;
      const link = {
        id: `share_${state.links.length + 1}`, ...body,
        fixedDataVersionId: body.fixedDataVersionId || null,
        createdAt: '2026-06-20T10:30:00Z', updatedAt: '2026-06-20T10:30:00Z',
      };
      state.links.unshift(link);
      state.tokens.set(token, { linkId: link.id, enabled: true });
      return response(200, { ...link, token });
    }
    const patchMatch = url.match(/^\/api\/share-links\/([^/]+)$/);
    if (patchMatch && method === 'PATCH') {
      const body = JSON.parse(options.body);
      const link = state.links.find((item) => item.id === patchMatch[1]);
      Object.assign(link, body);
      for (const tokenState of state.tokens.values()) {
        if (tokenState.linkId === link.id) tokenState.enabled = link.enabled;
      }
      return response(200, link);
    }
    const rotateMatch = url.match(/^\/api\/share-links\/([^/]+)\/rotate$/);
    if (rotateMatch && method === 'POST') {
      for (const [token, tokenState] of state.tokens.entries()) {
        if (tokenState.linkId === rotateMatch[1]) state.tokens.delete(token);
      }
      const token = `token-${++tokenCounter}`;
      state.tokens.set(token, { linkId: rotateMatch[1], enabled: true });
      return response(200, { ...state.links.find((item) => item.id === rotateMatch[1]), token });
    }
    const sharedMatch = url.match(/^\/api\/shared-data\/(.+)$/);
    if (sharedMatch) {
      const tokenState = state.tokens.get(sharedMatch[1]);
      return tokenState && tokenState.enabled ? response(200, { ok: true }) : response(404, { detail: '分享链接不可用' });
    }
    return response(404, { detail: `unhandled ${method} ${url}` });
  }

  const context = {
    console, JSON, Object, Array, Number, String, Date, Promise,
    encodeURIComponent, setTimeout, clearTimeout,
    App: {
      shareMode,
      currentMonth: '2026-06',
      ALL_DATA: {
        currentMonth: '2026-06', currentPlanKey: '2026-v1',
        actuals: { '2026-06': { branches: [{ orgId: 'ORG_A', n: 'A分公司', d: { 经营利润: 100 } }], regions: {}, national: {} } },
        _plans: {},
      },
    },
    document,
    localStorage: {
      getItem(key) { return storage.get(key) || null; },
      setItem(key, value) { storage.set(key, value); },
    },
    location: { origin: 'http://testserver' },
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    confirm: () => true,
    fetch,
    renderDataTab() { document.getElementById('data-panel').innerHTML = '<div>普通数据管理</div>'; },
    window: null,
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'dashboard-publish.js' });
  return { context, state, document };
}

async function adminFlow() {
  const { context, state, document } = createContext({ localRole: 'admin', meRole: 'admin' });
  context.renderDataTab();
  await context.renderPublishManagement();
  assert.ok(document.getElementById('publish-admin-root'));

  const created = await context.createDataDraft();
  assert.strictEqual(created.status, 'draft');
  assert.strictEqual(state.draftPayload.period, '2026-06');
  assert.deepStrictEqual(state.draftPayload.payload, context.App.ALL_DATA);

  assert.strictEqual(await context.publishDataVersion(created.id), false);
  assert.ok(document.getElementById('publishMessage').textContent.includes('validated'));

  state.nextValidationFails = true;
  assert.strictEqual(await context.validateDataVersion(created.id), false);
  assert.ok(document.getElementById('publishMessage').textContent.includes('校验失败'));
  assert.ok(document.getElementById('publishValidation').innerHTML.includes('branches 不能为空'));

  const validated = await context.validateDataVersion(created.id);
  assert.strictEqual(validated.status, 'validated');
  assert.ok(document.getElementById('publishValidation').innerHTML.includes('校验通过'));
  assert.ok(document.getElementById('publish-admin-root').innerHTML.includes('发布</button>'));

  const published = await context.publishDataVersion(created.id);
  assert.strictEqual(published.status, 'published');
  assert.ok(document.getElementById('publishMessage').textContent.includes('已发布'));

  document.orgInputs[0].checked = true;
  const link = await context.createShareLink();
  const oldToken = link.token;
  assert.ok(document.getElementById('publishToken').innerHTML.includes(oldToken));
  assert.ok(!JSON.stringify(context.__publishState.links).includes(oldToken));
  context.dismissPublishedToken();
  await context.refreshPublishManagement();
  assert.ok(!document.getElementById('publishToken').innerHTML.includes(oldToken));

  const rotated = await context.rotateShareToken(link.id);
  assert.notStrictEqual(rotated.token, oldToken);
  assert.strictEqual((await context.fetch(`/api/shared-data/${oldToken}`)).status, 404);
  assert.strictEqual((await context.fetch(`/api/shared-data/${rotated.token}`)).status, 200);

  await context.toggleShareLink(link.id, false);
  assert.strictEqual((await context.fetch(`/api/shared-data/${rotated.token}`)).status, 404);

  state.nextApiError = true;
  assert.strictEqual(await context.createDataDraft(), false);
  assert.ok(document.getElementById('publishMessage').textContent.includes('模拟服务错误'));
}

async function assertDenied(options, label) {
  const denied = createContext(options);
  denied.context.renderDataTab();
  await denied.context.renderPublishManagement();
  assert.strictEqual(denied.document.getElementById('publish-admin-root'), null, label);
  assert.strictEqual(await denied.context.createDataDraft(), false, label);
  const managementCalls = denied.state.fetches.filter((item) => /api\/(data-versions|share-links|organizations)/.test(item.url));
  assert.strictEqual(managementCalls.length, 0, label);
  return denied;
}

async function accessControls() {
  const empty = await assertDenied({ meRole: 'public' }, 'empty localStorage');
  const meRequest = empty.state.fetches.find((item) => item.url === '/api/me');
  assert.ok(meRequest);
  assert.strictEqual(meRequest.options.headers['X-Role'], undefined);
  assert.strictEqual(meRequest.options.headers['X-User-Id'], undefined);

  for (const role of ['branch', 'region', 'hq_management']) {
    await assertDenied({ localRole: role, meRole: role }, role);
  }
  await assertDenied({ localRole: 'admin', meRole: 'branch' }, 'forged local admin');
  await assertDenied({ localRole: 'admin', meFails: true }, '/api/me failure');

  const admin = createContext({ meRole: 'admin' });
  admin.context.renderDataTab();
  await admin.context.renderPublishManagement();
  assert.ok(admin.document.getElementById('publish-admin-root'));

  const shared = createContext({ localRole: 'admin', meRole: 'admin', shareMode: true });
  shared.context.renderDataTab();
  await shared.context.renderPublishManagement();
  assert.strictEqual(shared.document.getElementById('publish-admin-root'), null);
  assert.strictEqual(await shared.context.createDataDraft(), false);
  assert.strictEqual(await shared.context.createShareLink(), false);
  assert.strictEqual(await shared.context.rotateShareToken('share_1'), false);
  assert.strictEqual(shared.state.fetches.length, 0);
}
async function main() {
  await adminFlow();
  await accessControls();
  console.log('PASS admin can create, validate and publish current data');
  console.log('PASS validation errors and API failures are visible');
  console.log('PASS token is one-time, rotation and disable invalidate access');
  console.log('PASS /api/me is authoritative for admin visibility and management access');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
