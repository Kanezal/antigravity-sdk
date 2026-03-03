/**
 * Title Proxy — Renderer-side code for intercepting chat summaries.
 *
 * Generates JavaScript that runs in the workbench renderer process.
 * Uses Preact VNode context walk to find the summaries provider,
 * wraps getState() to inject custom titles from localStorage,
 * and captures onDidChange listeners for forced re-renders.
 *
 * All identifiers used here are STRUCTURALLY MATCHED, not hardcoded
 * minified variable names — this survives obfuscation changes.
 *
 * @module integration/title-proxy
 * @internal
 */

/** localStorage key prefix for custom titles */
const TITLES_STORAGE_PREFIX = 'ag-sdk-titles';

/** Data file prefix for extension-host to set titles */
const TITLES_DATA_PREFIX = 'ag-sdk-titles';

/**
 * Generate the renderer-side title proxy JavaScript.
 *
 * This code:
 * 1. BFS walks the Preact VNode tree (limit 3000, arrays not counted)
 * 2. Finds summaries provider via structural matching
 * 3. Wraps provider.getState() to inject custom titles
 * 4. Captures onDidChange listeners for forced re-renders
 * 5. Reads custom titles from localStorage + data file
 * 6. Exposes window.__agSDKTitles API for inline rename
 *
 * @param dataFilePath - Relative path to the JSON data file (for extension-host titles)
 * @returns JavaScript source code
 */
export function generateTitleProxyCode(namespace: string = 'default'): string {
  const slug = namespace.replace(/[^a-zA-Z0-9-]/g, '-');
  const storageKey = `${TITLES_STORAGE_PREFIX}-${slug}`;
  const dataFile = `./${TITLES_DATA_PREFIX}-${slug}.json`;
  return `
// ── AG SDK: Title Proxy ──────────────────────────────────────────
// Intercepts summaries provider to inject custom chat titles.
// Uses structural matching (obfuscation-safe).

(function initTitleProxy(){
  var PANEL_SEL='.antigravity-agent-side-panel';
  var TITLE_SEL='.flex.min-w-0.items-center.overflow-hidden';
  var STORAGE_KEY='${storageKey}';
  var DATA_FILE='${dataFile}';
  
  var _provider=null;
  var _origGetState=null;
  var _listeners=[];
  var _customTitles={};
  var _searchTime=0;

  // ── Load / Save ────────────────────────────────────────────────
  
  function loadTitles(){
    // Step 1: Load from localStorage (sync, fast)
    try{_customTitles=JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}');}catch(e){_customTitles={};}
    // Step 2: Merge extension-host titles from data file (async fetch)
    fetch(DATA_FILE).then(function(r){
      if(!r.ok)return;
      return r.text();
    }).then(function(text){
      if(!text)return;
      try{
        var extTitles=JSON.parse(text);
        if(extTitles&&typeof extTitles==='object'){
          for(var k in extTitles){_customTitles[k]=extTitles[k];}
          saveTitles();
          notifyListeners();
        }
      }catch(e){}
    }).catch(function(){});
  }
  
  function saveTitles(){
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify(_customTitles));}catch(e){}
  }
  
  // ── Notify ─────────────────────────────────────────────────────
  
  function notifyListeners(){
    for(var i=0;i<_listeners.length;i++){try{_listeners[i]();}catch(e){}}
  }
  
  // ── Provider Wrapping ──────────────────────────────────────────
  
  function wrapProvider(provider){
    if(provider.__agSDKWrapped)return;
    provider.__agSDKWrapped=true;
    _provider=provider;
    var origFn=provider.getState;
    _origGetState=origFn;
    
    // Wrap getState to inject custom titles
    provider.getState=function(){
      var state=origFn.call(provider);
      if(!state||!state.summaries)return state;
      var hasOverrides=false;
      for(var cid in _customTitles){if(state.summaries[cid]){hasOverrides=true;break;}}
      if(!hasOverrides)return state;
      var ns={};
      for(var k in state.summaries)ns[k]=state.summaries[k];
      for(var cid in _customTitles){
        if(ns[cid]){
          var copy={};for(var p in ns[cid])copy[p]=ns[cid][p];
          copy.summary=_customTitles[cid];
          ns[cid]=copy;
        }
      }
      var newState={};for(var sk in state)newState[sk]=state[sk];
      newState.summaries=ns;
      return newState;
    };
    
    // Intercept onDidChange to capture listeners
    var origOnDidChange=provider.onDidChange;
    provider.onDidChange=function(callback){
      _listeners.push(callback);
      var origDispose=origOnDidChange.call(this,callback);
      return{dispose:function(){
        var idx=_listeners.indexOf(callback);
        if(idx>=0)_listeners.splice(idx,1);
        origDispose.dispose();
      }};
    };
    
    console.log('[AG SDK] Title proxy active, custom titles:', Object.keys(_customTitles).length);
    
    // Force re-render so custom titles appear immediately
    // (without waiting for next native summaries update)
    setTimeout(function(){notifyListeners();},50);
  }
  
  // ── VNode BFS Walk ─────────────────────────────────────────────
  
  function findProvider(){
    if(_provider)return;
    var panel=document.querySelector(PANEL_SEL);
    if(!panel||!panel.__k)return;
    // Throttle only AFTER confirming panel exists (don't block retries when panel isn't mounted)
    var now=Date.now();
    if(_searchTime&&now-_searchTime<30000)return;
    _searchTime=now;
    var queue=[panel.__k],visited=0;
    while(queue.length>0&&visited<3000){
      var node=queue.shift();
      if(!node)continue;
      if(Array.isArray(node)){
        for(var ai=0;ai<node.length;ai++){if(node[ai])queue.push(node[ai]);}
        continue;
      }
      visited++;
      var comp=node.__c;
      if(comp&&comp.context&&typeof comp.context==='object'){
        for(var key in comp.context){
          try{
            var ctx=comp.context[key];
            if(!ctx||!ctx.props||!ctx.props.value)continue;
            var val=ctx.props.value;
            // Structural match: {provider: {getState() -> {summaries}}}
            if(val.provider&&typeof val.provider.getState==='function'){
              var ts=val.provider.getState();
              if(ts&&ts.summaries){wrapProvider(val.provider);return;}
            }
            // Structural match: {trajectorySummariesProvider: {getState() -> {summaries}}}
            if(val.trajectorySummariesProvider&&typeof val.trajectorySummariesProvider.getState==='function'){
              var ts2=val.trajectorySummariesProvider.getState();
              if(ts2&&ts2.summaries){wrapProvider(val.trajectorySummariesProvider);return;}
            }
          }catch(e){}
        }
      }
      // Direct props match
      if(comp&&comp.props&&comp.props.trajectorySummariesProvider){
        var tsp=comp.props.trajectorySummariesProvider;
        if(typeof tsp.getState==='function'){
          try{var ts3=tsp.getState();
            if(ts3&&ts3.summaries){wrapProvider(tsp);return;}
          }catch(e){}
        }
      }
      if(node.__k){
        if(Array.isArray(node.__k)){for(var ki=0;ki<node.__k.length;ki++){if(node.__k[ki])queue.push(node.__k[ki]);}}
        else{queue.push(node.__k);}
      }
    }
  }
  
  // ── CascadeId Resolution ───────────────────────────────────────
  
  function findCascadeIdByTitle(text){
    if(!_origGetState)return '';
    try{
      var state=_origGetState.call(_provider);
      if(!state||!state.summaries)return '';
      // Reverse lookup custom titles first
      for(var cid in _customTitles){if(_customTitles[cid]===text)return cid;}
      // Match original summaries
      var bestId='',bestTime=0;
      for(var cid in state.summaries){
        var e=state.summaries[cid];
        if(e&&e.summary===text){
          var t=0;try{t=new Date(e.lastModifiedTime).getTime();}catch(e){}
          if(!bestId||t>bestTime){bestId=cid;bestTime=t;}
        }
      }
      return bestId;
    }catch(e){return '';}
  }
  
  // ── Public API ─────────────────────────────────────────────────
  
  window.__agSDKTitles={
    rename:function(cascadeId,title){
      if(!cascadeId||!title)return false;
      _customTitles[cascadeId]=title;
      saveTitles();
      notifyListeners();
      return true;
    },
    renameByCurrentTitle:function(currentTitle,newTitle){
      var cid=findCascadeIdByTitle(currentTitle);
      if(!cid)return false;
      return this.rename(cid,newTitle);
    },
    remove:function(cascadeId){
      delete _customTitles[cascadeId];
      saveTitles();
      notifyListeners();
    },
    getTitle:function(cascadeId){return _customTitles[cascadeId]||null;},
    getAll:function(){var copy={};for(var k in _customTitles)copy[k]=_customTitles[k];return copy;},
    getActiveCascadeId:function(){
      var panel=document.querySelector(PANEL_SEL);
      if(!panel)return '';
      var titleEl=panel.querySelector(TITLE_SEL);
      if(!titleEl)return '';
      var text='';
      function findText(el){
        for(var i=0;i<el.childNodes.length;i++){
          var n=el.childNodes[i];
          if(n.nodeType===3&&n.textContent.trim().length>0)return n.textContent.trim();
          if(n.nodeType===1){var found=findText(n);if(found)return found;}
        }
        return '';
      }
      text=findText(titleEl);
      return text?findCascadeIdByTitle(text):'';
    },
    isReady:function(){return !!_provider;},
    reload:function(){loadTitles();notifyListeners();}
  };
  
  // ── Init ───────────────────────────────────────────────────────
  
  loadTitles();
  
  function poll(){
    findProvider();
  }
  
  // Poll until provider found, then every 30s for recovery
  var pollTimer=setInterval(function(){poll();},2000);
  
  // Initial attempt after DOM is ready
  if(document.querySelector(PANEL_SEL)){
    poll();
  }

})();
`;
}

/**
 * Get the data file name for extension-host titles.
 */
export function getTitlesDataFile(namespace: string = 'default'): string {
  const slug = namespace.replace(/[^a-zA-Z0-9-]/g, '-');
  return `${TITLES_DATA_PREFIX}-${slug}.json`;
}

/**
 * Get the localStorage key used by the renderer.
 */
export function getTitlesStorageKey(namespace: string = 'default'): string {
  const slug = namespace.replace(/[^a-zA-Z0-9-]/g, '-');
  return `${TITLES_STORAGE_PREFIX}-${slug}`;
}
