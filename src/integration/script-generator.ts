/**
 * Script Generator — Builds self-contained JS from integration configs.
 *
 * Generates a Trusted Types-safe integration script that:
 * - Uses ONLY createElement/textContent (no innerHTML)
 * - Uses MutationObserver for dynamic content
 * - Is fully self-contained (runs in renderer, no Node.js APIs)
 *
 * @module integration/script-generator
 *
 * @internal
 */

import { Selectors, AG_PREFIX, AG_DATA_ATTR } from './selectors';
import {
  IntegrationConfig,
  IntegrationPoint,
  IToastConfig,
  IToastRow,
  TurnMetric,
  IButtonIntegration,
  ITurnMetaIntegration,
  IUserBadgeIntegration,
  IBotActionIntegration,
  IDropdownIntegration,
  ITitleIntegration,
} from './types';

/**
 * Generates a self-contained JavaScript integration script
 * from an array of IntegrationConfig objects.
 */
export class ScriptGenerator {
  /**
   * Generate the complete integration script.
   *
   * @param configs — Registered integration configurations
   * @param namespace — Optional namespace slug for file naming (used for heartbeat URL)
   * @returns — Complete JS code as a string
   */
  generate(configs: IntegrationConfig[], namespace?: string): string {
    const parts: string[] = [];

    parts.push(this._header());
    parts.push(this._css(configs));
    parts.push(this._helpers());
    parts.push(this._toast());
    parts.push(this._stats());

    // Generate code for each integration point
    const grouped = this._groupByPoint(configs);

    for (const [point, cfgs] of Object.entries(grouped)) {
      parts.push(this._generatePoint(point as IntegrationPoint, cfgs));
    }

    parts.push(this._mainLoop(Object.keys(grouped) as IntegrationPoint[]));
    parts.push(this._footer(namespace));

    return parts.join('\n');
  }

  // ─── Grouping ──────────────────────────────────────────────────────

  private _groupByPoint(configs: IntegrationConfig[]): Record<string, IntegrationConfig[]> {
    const groups: Record<string, IntegrationConfig[]> = {};
    for (const c of configs) {
      if (c.enabled === false) continue;
      if (!groups[c.point]) groups[c.point] = [];
      groups[c.point].push(c);
    }
    return groups;
  }

  // ─── Code Sections ────────────────────────────────────────────────

  private _header(): string {
    return `(function agSDK(){
'use strict';
if(window.__agSDK)return;
window.__agSDK=true;

// ─── Theme Detection ───
var _isDark=document.body.classList.contains('vscode-dark')||document.body.classList.contains('vscode-high-contrast');
var _theme={
  bg:_isDark?'rgba(25,25,30,.95)':'rgba(245,245,250,.95)',
  fg:_isDark?'#ccc':'#333',
  fgDim:_isDark?'rgba(200,200,200,.45)':'rgba(80,80,80,.5)',
  fgHover:_isDark?'rgba(200,200,200,.8)':'rgba(40,40,40,.9)',
  accent:_isDark?'#4fc3f7':'#0288d1',
  accentBg:_isDark?'rgba(79,195,247,.12)':'rgba(2,136,209,.08)',
  success:_isDark?'#81c784':'#388e3c',
  successBg:_isDark?'rgba(76,175,80,.1)':'rgba(56,142,60,.06)',
  warn:_isDark?'#ffb74d':'#e65100',
  border:_isDark?'rgba(79,195,247,.06)':'rgba(0,0,0,.06)',
  borderHover:_isDark?'rgba(79,195,247,.2)':'rgba(2,136,209,.15)',
  sep:_isDark?'rgba(255,255,255,.06)':'rgba(0,0,0,.06)',
  shadow:_isDark?'rgba(0,0,0,.5)':'rgba(0,0,0,.15)',
  metaBg:_isDark?'linear-gradient(135deg,rgba(79,195,247,.03),rgba(156,39,176,.02))':'linear-gradient(135deg,rgba(2,136,209,.03),rgba(123,31,162,.02))',
  metaBgHover:_isDark?'linear-gradient(135deg,rgba(79,195,247,.07),rgba(156,39,176,.05))':'linear-gradient(135deg,rgba(2,136,209,.07),rgba(123,31,162,.05))'
};
// Watch for theme changes (VS Code toggles body classes)
new MutationObserver(function(){var newDark=document.body.classList.contains('vscode-dark');if(newDark!==_isDark){location.reload();}}).observe(document.body,{attributes:true,attributeFilter:['class']});
`;
  }

  private _footer(namespace?: string): string {
    // The heartbeat file is in the same directory as the script.
    // We use sync XHR (allowed in renderer since we're in a script tag,
    // not a module) to check the file before starting.
    // Max age: 48 hours (172800000ms) — enough to survive normal restarts
    // but catches disabled extensions reliably.
    const heartbeatFile = namespace ? `ag-sdk-${namespace}-heartbeat` : 'ag-sdk-heartbeat';
    return `
var _heartbeatMaxAge=172800000;
function checkHeartbeat(){
  try{
    var xhr=new XMLHttpRequest();
    xhr.open('GET','./${heartbeatFile}?t='+Date.now(),false);
    xhr.send();
    if(xhr.status!==200)return false;
    var ts=parseInt(xhr.responseText,10);
    if(isNaN(ts))return false;
    return(Date.now()-ts)<_heartbeatMaxAge;
  }catch(e){return false;}
}
function boot(){
  if(!checkHeartbeat()){
    console.log('[AG SDK] Heartbeat missing or stale — extension disabled? Skipping.');
    return;
  }
  if(document.readyState==='complete')setTimeout(start,3000);
  else window.addEventListener('load',function(){setTimeout(start,3000);});
}
boot();
})();`;
  }

  private _css(configs: IntegrationConfig[]): string {
    // Only include CSS for points that are actually used
    const points = new Set(configs.map(c => c.point));

    // All colors now use _theme variables for light/dark mode support
    // CSS is generated as a JS template that reads _theme at runtime
    return `
// ─── Theme-Aware CSS ───
var _cssRules=[
  '.${AG_PREFIX}meta{padding:3px 8px;background:'+_theme.metaBg+';border-top:1px solid '+_theme.border+';font-family:"Cascadia Code","Fira Code",monospace;font-size:9px;color:'+_theme.fgDim+';display:flex;align-items:center;gap:5px;flex-wrap:wrap;transition:all .2s;cursor:default;user-select:none;margin-top:2px;border-radius:0 0 6px 6px}',
  '.${AG_PREFIX}meta:hover{background:'+_theme.metaBgHover+';color:'+_theme.fgHover+'}',
  '.${AG_PREFIX}t{padding:1px 4px;border-radius:3px;font-size:8px;font-weight:700;letter-spacing:.3px}',
  '.${AG_PREFIX}u{background:'+_theme.successBg+';color:'+_theme.success+'}',
  '.${AG_PREFIX}b{background:'+_theme.accentBg+';color:'+_theme.accent+'}',
  '.${AG_PREFIX}k{color:'+_theme.fgDim+';font-size:8px}',
  '.${AG_PREFIX}v{color:'+_theme.fg+';font-size:8px;opacity:.55}',
  '.${AG_PREFIX}hi{color:'+_theme.accent+'}',
  '.${AG_PREFIX}w{color:'+_theme.warn+'}',
  '.${AG_PREFIX}s{color:'+_theme.sep+'}',
  // Toast
  '.${AG_PREFIX}toast{position:fixed;bottom:80px;right:20px;background:'+_theme.bg+';border:1px solid '+_theme.borderHover+';border-radius:8px;padding:10px 14px;font-family:"Cascadia Code",monospace;font-size:10px;color:'+_theme.fg+';z-index:99999;max-width:320px;backdrop-filter:blur(10px);box-shadow:0 4px 24px '+_theme.shadow+';animation:${AG_PREFIX}fade .25s ease}',
  '@keyframes ${AG_PREFIX}fade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}',
  '.${AG_PREFIX}toast-t{color:'+_theme.accent+';font-weight:700;margin-bottom:5px;font-size:11px;display:flex;align-items:center;gap:6px}',
  '.${AG_PREFIX}toast-r{display:flex;gap:8px;margin:1px 0}',
  '.${AG_PREFIX}toast-k{color:'+_theme.fgDim+';min-width:70px}',
  '.${AG_PREFIX}toast-v{color:'+_theme.fg+'}',
  '.${AG_PREFIX}toast-badge{font-size:8px;padding:1px 5px;border-radius:3px;font-weight:700}',
  // Buttons
  '.${AG_PREFIX}hdr{display:inline-flex;align-items:center;gap:3px;padding:1px 6px;border-radius:4px;cursor:pointer;color:'+_theme.fgDim+';font-size:9px;font-family:"Cascadia Code",monospace;transition:all .15s;user-select:none}',
  '.${AG_PREFIX}hdr:hover{background:'+_theme.accentBg+';color:'+_theme.accent+'}',
  '.${AG_PREFIX}inp{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;border-radius:4px;cursor:pointer;color:'+_theme.fgDim+';font-size:11px;transition:all .15s;flex-shrink:0;padding:0 4px;font-family:"Cascadia Code",monospace}',
  '.${AG_PREFIX}inp:hover{background:'+_theme.accentBg+';color:'+_theme.accent+'}',
  '.${AG_PREFIX}menu{padding:4px 8px;cursor:pointer;font-size:11px;color:'+_theme.fg+';opacity:.7;transition:all .12s;display:flex;align-items:center;gap:6px;white-space:nowrap}',
  '.${AG_PREFIX}menu:hover{background:'+_theme.accentBg+';color:'+_theme.accent+';opacity:1}',
  '.${AG_PREFIX}vote{display:inline-flex;align-items:center;gap:3px;padding:1px 6px;border-radius:3px;cursor:pointer;color:'+_theme.fgDim+';font-size:9px;font-family:"Cascadia Code",monospace;transition:all .15s;margin-left:4px}',
  '.${AG_PREFIX}vote:hover{background:'+_theme.accentBg+';color:'+_theme.accent+'}',
  '.${AG_PREFIX}ubadge{display:inline-flex;align-items:center;gap:2px;padding:1px 5px;border-radius:3px;background:'+_theme.successBg+';cursor:pointer;color:'+_theme.success+';opacity:.4;font-size:8px;font-family:"Cascadia Code",monospace;transition:all .15s;margin-left:3px}',
  '.${AG_PREFIX}ubadge:hover{background:'+_theme.successBg+';color:'+_theme.success+';opacity:1}',
  '.${AG_PREFIX}title-hint{position:absolute;right:0;top:50%;transform:translateY(-50%);font-size:8px;color:'+_theme.accent+';opacity:.3;pointer-events:none;font-family:"Cascadia Code",monospace;transition:opacity .2s}',
  '.${AG_PREFIX}title-wrap:hover .${AG_PREFIX}title-hint{opacity:1}'
];
var css=document.createElement('style');
css.textContent=_cssRules.join('\\n');
document.head.appendChild(css);
`;
  }

  private _helpers(): string {
    return `
function mk(tag,cls,txt){var e=document.createElement(tag);if(cls)e.className=cls;if(txt!==undefined)e.textContent=txt;return e;}
function fmt(n){return n>=1000?(n/1000).toFixed(1)+'k':''+n;}
`;
  }

  private _toast(): string {
    return `
var _toastT=0;
function toast(title,badge,rows){
  var old=document.querySelector('.${AG_PREFIX}toast');if(old)old.remove();
  var t=mk('div','${AG_PREFIX}toast');
  var hdr=mk('div','${AG_PREFIX}toast-t');
  hdr.appendChild(document.createTextNode(title));
  if(badge){var b=mk('span','${AG_PREFIX}toast-badge');b.textContent=badge[0];b.style.background=badge[1];b.style.color=badge[2];hdr.appendChild(b);}
  t.appendChild(hdr);
  rows.forEach(function(r){var row=mk('div','${AG_PREFIX}toast-r');row.appendChild(mk('span','${AG_PREFIX}toast-k',r[0]));row.appendChild(mk('span','${AG_PREFIX}toast-v',r[1]));t.appendChild(row);});
  document.body.appendChild(t);
  clearTimeout(_toastT);_toastT=setTimeout(function(){if(t.parentNode)t.remove();},6000);
  t.addEventListener('click',function(){t.remove();});
}
`;
  }

  private _stats(): string {
    return `
function getStats(){
  var c=document.querySelector(${JSON.stringify(Selectors.TURNS_CONTAINER)});
  if(!c)return null;
  var turns=0,uC=0,bC=0,code=0;
  Array.from(c.children).forEach(function(ch){
    if(ch.getAttribute('${AG_DATA_ATTR}')||ch.children.length<1)return;
    turns++;
    uC+=(ch.children[0]?.textContent?.trim()||'').length;
    bC+=(ch.children[1]?.textContent?.trim()||'').length;
    code+=(ch.children[1]?.querySelectorAll('pre')?.length||0);
  });
  return{turns:turns,u:uC,b:bC,code:code};
}
`;
  }

  // ─── Point generators ─────────────────────────────────────────────

  private _generatePoint(point: IntegrationPoint, configs: IntegrationConfig[]): string {
    switch (point) {
      case IntegrationPoint.TOP_BAR:
        return this._genTopBar(configs as IButtonIntegration[]);
      case IntegrationPoint.TOP_RIGHT:
        return this._genTopRight(configs as IButtonIntegration[]);
      case IntegrationPoint.INPUT_AREA:
        return this._genInputArea(configs as IButtonIntegration[]);
      case IntegrationPoint.BOTTOM_ICONS:
        return this._genBottomIcons(configs as IButtonIntegration[]);
      case IntegrationPoint.TURN_METADATA:
        return this._genTurnMeta(configs as ITurnMetaIntegration[]);
      case IntegrationPoint.USER_BADGE:
        return this._genUserBadge(configs as IUserBadgeIntegration[]);
      case IntegrationPoint.BOT_ACTION:
        return this._genBotAction(configs as IBotActionIntegration[]);
      case IntegrationPoint.DROPDOWN_MENU:
        return this._genDropdown(configs as IDropdownIntegration[]);
      case IntegrationPoint.CHAT_TITLE:
        return this._genTitle(configs as ITitleIntegration[]);
      default:
        return `// Unknown point: ${point}`;
    }
  }

  private _genToastCall(toast?: IToastConfig): string {
    if (!toast) return '';
    const badge = toast.badge
      ? `[${JSON.stringify(toast.badge.text)},${JSON.stringify(toast.badge.bgColor)},${JSON.stringify(toast.badge.textColor)}]`
      : 'null';
    const rows = toast.rows
      .map(r => {
        if (r.dynamic) {
          return `[${JSON.stringify(r.key)},${r.value}]`;
        }
        return `[${JSON.stringify(r.key)},${JSON.stringify(r.value)}]`;
      })
      .join(',');
    return `toast(${JSON.stringify(toast.title)},${badge},[${rows}]);`;
  }

  private _genTopBar(configs: IButtonIntegration[]): string {
    const buttons = configs.map(c => {
      const toastCall = this._genToastCall(c.toast);
      return `  var btn_${c.id}=mk('a','${AG_PREFIX}hdr ${AG_PREFIX}${c.id}');
  btn_${c.id}.textContent=${JSON.stringify(c.icon)};
  btn_${c.id}.title=${JSON.stringify(c.tooltip || '')};
  btn_${c.id}.addEventListener('click',function(){${toastCall}});
  iconsArea.insertBefore(btn_${c.id},iconsArea.children[1]);`;
    });

    return `
function integrateTopBar(){
  var p=document.querySelector(${JSON.stringify(Selectors.PANEL)});if(!p)return;
  var topBar=p.querySelector(${JSON.stringify(Selectors.TOP_BAR)});if(!topBar)return;
  var iconsArea=topBar.querySelector(${JSON.stringify(Selectors.TOP_ICONS)});
  if(!iconsArea||iconsArea.querySelector('.${AG_PREFIX}${configs[0].id}'))return;
${buttons.join('\n')}
}
`;
  }

  private _genTopRight(configs: IButtonIntegration[]): string {
    const buttons = configs.map(c => {
      const toastCall = this._genToastCall(c.toast);
      return `  var btn_${c.id}=mk('a','${AG_PREFIX}hdr ${AG_PREFIX}${c.id}');
  btn_${c.id}.textContent=${JSON.stringify(c.icon)};
  btn_${c.id}.title=${JSON.stringify(c.tooltip || '')};
  btn_${c.id}.addEventListener('click',function(){${toastCall}});
  iconsArea.insertBefore(btn_${c.id},iconsArea.lastElementChild);`;
    });

    return `
function integrateTopRight(){
  var p=document.querySelector(${JSON.stringify(Selectors.PANEL)});if(!p)return;
  var topBar=p.querySelector(${JSON.stringify(Selectors.TOP_BAR)});if(!topBar)return;
  var iconsArea=topBar.querySelector(${JSON.stringify(Selectors.TOP_ICONS)});
  if(!iconsArea||iconsArea.querySelector('.${AG_PREFIX}${configs[0].id}'))return;
${buttons.join('\n')}
}
`;
  }

  private _genInputArea(configs: IButtonIntegration[]): string {
    const buttons = configs.map(c => {
      const toastCall = this._genToastCall(c.toast);
      return `  var btn=mk('div','${AG_PREFIX}inp ${AG_PREFIX}${c.id}');
  btn.textContent=${JSON.stringify(c.icon)};
  btn.title=${JSON.stringify(c.tooltip || '')};
  btn.addEventListener('click',function(){${toastCall}});
  btnRow.insertBefore(btn,btnRow.firstChild);`;
    });

    return `
function integrateInputArea(){
  var ib=document.querySelector(${JSON.stringify(Selectors.INPUT_BOX)});
  if(!ib||ib.querySelector('.${AG_PREFIX}${configs[0].id}'))return;
  var allBtns=ib.querySelectorAll('button,[role="button"]');
  if(allBtns.length===0)return;
  var btnRow=allBtns[allBtns.length-1].parentElement;if(!btnRow)return;
${buttons.join('\n')}
}
`;
  }

  private _genBottomIcons(configs: IButtonIntegration[]): string {
    const buttons = configs.map(c => {
      const toastCall = this._genToastCall(c.toast);
      return `  var btn=mk('div','${AG_PREFIX}inp ${AG_PREFIX}${c.id}');
  btn.textContent=${JSON.stringify(c.icon)};
  btn.title=${JSON.stringify(c.tooltip || '')};
  btn.addEventListener('click',function(){${toastCall}});
  row.appendChild(btn);`;
    });

    return `
function integrateBottomIcons(){
  var ib=document.querySelector(${JSON.stringify(Selectors.INPUT_BOX)});
  if(!ib||ib.querySelector('.${AG_PREFIX}${configs[0].id}'))return;
  var rows=ib.querySelectorAll('.flex.items-center');
  var row=null;
  for(var i=0;i<rows.length;i++){if(rows[i].querySelectorAll('svg').length>=2){row=rows[i];}}
  if(!row)return;
${buttons.join('\n')}
}
`;
  }

  private _genTurnMeta(configs: ITurnMetaIntegration[]): string {
    // Take first config for metrics (single turn metadata style)
    const cfg = configs[0];
    const metricParts: string[] = [];

    for (const m of cfg.metrics) {
      switch (m) {
        case 'turnNumber':
          metricParts.push(`meta.appendChild(mk('span','${AG_PREFIX}t ${AG_PREFIX}b','T'+tI));`);
          break;
        case 'userCharCount':
          metricParts.push(`if(uL>0){meta.appendChild(mk('span','${AG_PREFIX}t ${AG_PREFIX}u','USER'));meta.appendChild(mk('span','${AG_PREFIX}k',fmt(uL)));}`);
          break;
        case 'separator':
          metricParts.push(`if(uL>0&&bL>0)meta.appendChild(mk('span','${AG_PREFIX}s','\\u2502'));`);
          break;
        case 'aiCharCount':
          metricParts.push(`if(bL>0){meta.appendChild(mk('span','${AG_PREFIX}t ${AG_PREFIX}b','AI'));meta.appendChild(mk('span','${AG_PREFIX}k',fmt(bL)));}`);
          break;
        case 'codeBlocks':
          metricParts.push(`if(codes>0){meta.appendChild(mk('span','${AG_PREFIX}k','code:'));meta.appendChild(mk('span','${AG_PREFIX}v ${AG_PREFIX}w',''+codes));}`);
          break;
        case 'thinkingIndicator':
          metricParts.push(`if(brain)meta.appendChild(mk('span','${AG_PREFIX}v','\\u{1F9E0}'));`);
          break;
        case 'ratio':
          metricParts.push(`if(uL>0&&bL>0){meta.appendChild(mk('span','${AG_PREFIX}k',(bL/uL).toFixed(1)+'x'));}`);
          break;
      }
    }

    const clickHandler = cfg.clickable !== false
      ? `meta.addEventListener('click',function(){toast('Turn '+tI,null,[['user:',fmt(uL)],['AI:',fmt(bL)],['ratio:',uL>0?(bL/uL).toFixed(1)+'x':'\\u2014']]);});`
      : '';

    return `
function integrateTurnMeta(){
  var c=document.querySelector(${JSON.stringify(Selectors.TURNS_CONTAINER)});if(!c)return;
  var tI=0;
  Array.from(c.children).forEach(function(turn){
    if(turn.getAttribute('${AG_DATA_ATTR}')||turn.children.length<1)return;
    turn.setAttribute('${AG_DATA_ATTR}','1');
    tI++;var uL=(turn.children[0]?.textContent?.trim()||'').length;
    var bL=(turn.children[1]?.textContent?.trim()||'').length;
    if(uL===0&&bL===0)return;
    var codes=turn.children[1]?.querySelectorAll('pre')?.length||0;
    var brain=(turn.children[1]?.textContent||'').includes('Thought');
    var meta=mk('div','${AG_PREFIX}meta');
    ${metricParts.join('\n    ')}
    ${clickHandler}
    turn.appendChild(meta);
  });
}
`;
  }

  private _genUserBadge(configs: IUserBadgeIntegration[]): string {
    const cfg = configs[0];
    let displayExpr = 'fmt(uLen)+" ch"';
    if (cfg.display === 'wordCount') {
      displayExpr = '(txt.split(/\\\\s+/).length)+" w"';
    } else if (cfg.display === 'custom' && cfg.customFormat) {
      displayExpr = cfg.customFormat;
    }

    return `
function integrateUserBadges(){
  var c=document.querySelector(${JSON.stringify(Selectors.TURNS_CONTAINER)});if(!c)return;
  Array.from(c.children).forEach(function(turn,i){
    if(turn.getAttribute('${AG_DATA_ATTR}u')||turn.children.length<1)return;
    var bubble=turn.children[0]?.querySelector(${JSON.stringify(Selectors.USER_BUBBLE)});
    if(!bubble)return;
    var txt=turn.children[0]?.textContent?.trim()||'';
    var uLen=txt.length;if(uLen<5)return;
    turn.setAttribute('${AG_DATA_ATTR}u','1');
    var row=turn.children[0]?.querySelector('.flex.w-full,.flex.flex-row')||turn.children[0];
    var badge=mk('span','${AG_PREFIX}ubadge');
    badge.textContent=${displayExpr};
    badge.title='SDK: User message';
    row.appendChild(badge);
  });
}
`;
  }

  private _genBotAction(configs: IBotActionIntegration[]): string {
    const items = configs.map(c => {
      const toastCall = this._genToastCall(c.toast);
      return `var b=mk('span','${AG_PREFIX}vote');b.textContent=${JSON.stringify(c.icon + ' ' + c.label)};
      b.addEventListener('click',function(ev){ev.stopPropagation();${toastCall}});
      row.appendChild(b);`;
    });

    return `
function integrateBotAction(){
  var c=document.querySelector(${JSON.stringify(Selectors.TURNS_CONTAINER)});if(!c)return;
  c.querySelectorAll('span,button,a,div').forEach(function(el){
    if(el.getAttribute('${AG_DATA_ATTR}v'))return;
    var txt=el.textContent?.trim();
    if(txt==='Good'||txt==='Bad'){
      var row=el.parentElement;if(!row||row.querySelector('.${AG_PREFIX}vote'))return;
      el.setAttribute('${AG_DATA_ATTR}v','1');
      ${items.join('\n      ')}
    }
  });
}
`;
  }

  private _genDropdown(configs: IDropdownIntegration[]): string {
    const markers = JSON.stringify(Selectors.DROPDOWN_MARKER_TEXT);
    const items = configs.map(c => {
      const toastCall = this._genToastCall(c.toast);
      const sep = c.separator
        ? `var sep=mk('div','');sep.style.cssText='height:1px;background:rgba(255,255,255,.06);margin:4px 8px';dd.appendChild(sep);`
        : '';
      return `${sep}
    var mi=mk('div','${AG_PREFIX}menu');
    ${c.icon ? `mi.appendChild(mk('span','',${JSON.stringify(c.icon)}));` : ''}
    mi.appendChild(document.createTextNode(${JSON.stringify(c.label)}));
    mi.addEventListener('click',function(){${toastCall}});
    dd.appendChild(mi);`;
    });

    return `
function integrateDropdown(){
  var dds=document.querySelectorAll('.rounded-bg.py-1,.rounded-lg.py-1');
  dds.forEach(function(dd){
    if(dd.getAttribute('${AG_DATA_ATTR}m'))return;
    var items=dd.querySelectorAll(${JSON.stringify(Selectors.DROPDOWN_ITEM)});
    var markers=${markers};
    var found=false;
    items.forEach(function(it){markers.forEach(function(m){if((it.textContent||'').includes(m))found=true;});});
    if(!found)return;
    dd.setAttribute('${AG_DATA_ATTR}m','1');
    ${items.join('\n    ')}
  });
}
`;
  }

  private _genTitle(configs: ITitleIntegration[]): string {
    const cfg = configs[0];
    const toastCall = this._genToastCall(cfg.toast);
    const event = cfg.interaction || 'dblclick';

    return `
function integrateTitle(){
  var p=document.querySelector(${JSON.stringify(Selectors.PANEL)});if(!p)return;
  var el=p.querySelector(${JSON.stringify(Selectors.TITLE)});
  if(!el||el.getAttribute('${AG_DATA_ATTR}t'))return;
  el.setAttribute('${AG_DATA_ATTR}t','1');
  el.style.cursor='pointer';
  el.classList.add('${AG_PREFIX}title-wrap');
  el.style.position='relative';
  ${cfg.hint ? `var hint=mk('span','${AG_PREFIX}title-hint',${JSON.stringify(cfg.hint)});el.appendChild(hint);` : ''}
  el.addEventListener(${JSON.stringify(event)},function(){
    var title=el.textContent?.replace(${JSON.stringify(cfg.hint || '')},'')?.trim()||'';
    ${toastCall || `toast('Chat',null,[['title:',title],['chars:',''+title.length]]);`}
  });
}
`;
  }

  // ─── Main loop ────────────────────────────────────────────────────

  private _mainLoop(points: IntegrationPoint[]): string {
    const fnMap: Record<string, string> = {
      [IntegrationPoint.TOP_BAR]: 'integrateTopBar',
      [IntegrationPoint.TOP_RIGHT]: 'integrateTopRight',
      [IntegrationPoint.INPUT_AREA]: 'integrateInputArea',
      [IntegrationPoint.BOTTOM_ICONS]: 'integrateBottomIcons',
      [IntegrationPoint.TURN_METADATA]: 'integrateTurnMeta',
      [IntegrationPoint.USER_BADGE]: 'integrateUserBadges',
      [IntegrationPoint.BOT_ACTION]: 'integrateBotAction',
      [IntegrationPoint.DROPDOWN_MENU]: 'integrateDropdown',
      [IntegrationPoint.CHAT_TITLE]: 'integrateTitle',
    };

    const calls = points.map(p => `    ${fnMap[p]} (); `).join('\n');

    return `
    function fullScan() {
${calls}
    }
    var _timer = 0;
    function debounced() { clearTimeout(_timer); _timer = setTimeout(function () { requestAnimationFrame(fullScan); }, 400); }
    function start() {
      var p = document.querySelector(${JSON.stringify(Selectors.PANEL)});
      if (!p) { setTimeout(start, 1000); return; }
      fullScan();
      new MutationObserver(debounced).observe(p, { childList: true, subtree: true });
      setInterval(fullScan, 8000);
      console.log('[AG SDK] Active \\u2014 ${points.length} integration points');
    }
    `;
  }
}
