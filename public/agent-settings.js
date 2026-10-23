(function(){
  let revision;
  const $=id=>document.getElementById(id);
  function updateMode(){ $('agent-commandList').hidden=$('agent-terminal').value!=='approved'; }
  $('agent-terminal').addEventListener('change',updateMode);
  async function load(){
    revision=undefined;
    $('agentSettingsStatus').textContent='Loading shared laptop settings…';
    try{const result=await api('/api/agent/settings',{});revision=result.revision;
      for(const key of ['repository','webSearch','webFetch','browser'])$('agent-'+key).checked=result.settings[key];
      $('agent-terminal').value=result.settings.terminal;updateMode();$('agent-approvedCommands').value=result.settings.approvedCommands.join('\n');$('agent-testCommand').value=result.settings.testCommand;$('agent-maxRounds').value=result.settings.maxRounds;
      $('agentSettingsStatus').textContent='Shared by web and desktop on this laptop. Changes apply to new requests.';
    }catch(error){revision=undefined;$('agentSettingsStatus').textContent=error.message;}
  }
  async function save(){
    if(!revision)throw new Error('Reload Agent & tools settings before saving');
    const settings={};for(const key of ['repository','webSearch','webFetch','browser'])settings[key]=$('agent-'+key).checked;
    settings.terminal=$('agent-terminal').value;settings.approvedCommands=$('agent-approvedCommands').value.split('\n').map(line=>line.trim()).filter(Boolean);settings.testCommand=$('agent-testCommand').value.trim();settings.maxRounds=Number($('agent-maxRounds').value);
    const result=await api('/api/agent/settings/save',{settings,revision});revision=result.revision;$('agentSettingsStatus').textContent='Saved on laptop.';
  }
  window.AgentSettings={load,save};
  // Load only while opening Settings; Cancel never writes tool permissions.
  new MutationObserver(()=>{if(!$('settingsModal').classList.contains('hidden'))load();}).observe($('settingsModal'),{attributes:true,attributeFilter:['class']});
})();
