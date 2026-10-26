import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = express();
app.use(express.json());
app.use(express.static(path.join(root, 'public')));
const list = { tasks: [], events: [], incidents: [], discussions: [], memories: [], skills: [] };
app.get('/api/agent/bridge/v1/status', (_req, res) => res.json({
  worker: 'not_installed', supervisor: 'not_installed', browser: 'ready_readonly', executionEnabled: false
}));
app.get('/api/agent/bridge/v1/:kind', (req, res) => {
  const values = { tasks:'tasks', audit:'events', incidents:'incidents',
    discussions:'discussions', memories:'memories', skills:'skills' };
  const key = values[req.params.kind];
  if (!key) return res.status(404).json({ error:'Not found' });
  return res.json({ [key]:list[key] });
});
const server = createServer(app);
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const base = 'http://127.0.0.1:' + server.address().port;
const executablePath = ['/usr/bin/google-chrome','/usr/bin/google-chrome-stable',
  '/usr/bin/chromium','/usr/bin/chromium-browser'].find(existsSync);
if (!executablePath) throw new Error('No Chrome/Chromium installed on CI runner');

const out = process.env.VANTA_SCREENSHOT_DIR || '/tmp/vanta-agent-mobile-screens';
mkdirSync(out,{recursive:true});
let browser;
try {
  browser = await chromium.launch({ executablePath, headless:true, args:['--no-sandbox','--disable-dev-shm-usage'] });
  for (const width of [320,375,430,768,1024,1280]) {
    const page = await browser.newPage({ viewport:{width,height:850}, deviceScaleFactor:1 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const response = await page.goto(base+'/ai-agent.html',{waitUntil:'networkidle'});
    assert.equal(response.status(),200,'AI Agent must load at '+width+'px');
    await page.waitForFunction(() => document.getElementById('browser')?.textContent?.includes('Siap'));
    const measurements = await page.evaluate(() => {
      const visible = node => {
        const box = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0;
      };
      const tabs = [...document.querySelectorAll('[data-tab]')];
      return {
        scrollWidth:document.documentElement.scrollWidth,
        width:document.documentElement.clientWidth,
        tabRects:tabs.map(t=>({label:t.textContent, left:t.getBoundingClientRect().left,
          right:t.getBoundingClientRect().right, visible:visible(t)})),
        inputFont:getComputedStyle(document.getElementById('instruction')).fontSize,
        navigation:tabs.map(t=>t.getAttribute('aria-selected')),
        connection:document.getElementById('connectionLabel').textContent,
        browser:document.getElementById('browser').textContent
      };
    });
    assert.ok(measurements.scrollWidth <= measurements.width + 1,
      width+'px page overflows horizontally: '+JSON.stringify(measurements));
    for (const tab of measurements.tabRects) {
      assert.ok(tab.visible && tab.left>=-1 && tab.right<=width+1,
        width+'px tab is clipped: '+JSON.stringify(tab));
    }
    assert.deepEqual(measurements.navigation,['true','false','false','false']);
    assert.equal(measurements.browser,'Siap · baca saja');
    assert.equal(errors.length,0,width+'px page errors: '+errors.join('; '));
    if(width<=430) assert.equal(measurements.inputFont,'16px','Mobile input must not trigger Safari zoom');
    // Check real tab switching at all widths, not just static markup.
    for(const [key,selector] of [['approvals','#approvalsList'],
      ['activity','#auditList'],['knowledge','#memoryList'],['tasks','#taskForm']]) {
      await page.locator('[data-tab="'+key+'"]').click();
      assert.equal(await page.locator('[data-tab="'+key+'"]').getAttribute('aria-selected'),'true');
      assert.ok(await page.locator(selector).isVisible(),width+'px '+key+' panel must display');
    }
    if(width===375 || width===1280) {
      await page.screenshot({path:path.join(out,'agent-'+width+'.png'),fullPage:true});
    }
    console.log('PASS browser viewport '+width+'px: no overflow, all tabs accessible, labels localized');
    await page.close();
  }
} finally {
  if(browser) await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
