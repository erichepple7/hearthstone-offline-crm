(function(){
 'use strict';
 const providers={
  instagram:{label:'Instagram',mark:'◎',setup:'https://developers.facebook.com/apps/',note:'Business or Creator account'},
  facebook:{label:'Facebook',mark:'f',setup:'https://developers.facebook.com/apps/',note:'Facebook Page'},
  youtube:{label:'YouTube',mark:'▶',setup:'https://console.cloud.google.com/apis/library/youtube.googleapis.com',note:'YouTube channel'},
  tiktok:{label:'TikTok',mark:'♪',setup:'https://developers.tiktok.com/apps/',note:'TikTok creator account'}
 };
 const providerKeys=Object.keys(providers);
 const connectedStatus=()=>window.crmSocialPublishing?.connections||{};
 const itemPlatforms=item=>Array.isArray(item?.platforms)?item.platforms.filter(key=>providers[key]):[];
 const platformLabel=key=>providers[key]?.label||key;
 const platformChecks=item=>providerKeys.map(key=>`<label class="social-platform-check"><input type="checkbox" name="platforms" value="${key}" ${itemPlatforms(item).includes(key)?'checked':''}><span class="social-mark ${key}">${providers[key].mark}</span><strong>${providers[key].label}</strong></label>`).join('');
 const platformCaptions=item=>providerKeys.map(key=>`<label class="field full social-caption-field" data-social-caption="${key}" ${itemPlatforms(item).includes(key)?'':'hidden'}><span>${providers[key].label} caption</span><textarea name="caption_${key}" rows="4" placeholder="Caption for ${providers[key].label}">${esc(item?.platform_captions?.[key]||item?.content||'')}</textarea></label>`).join('');

 function socialConnectionHtml(){
  const statuses=connectedStatus();
  return `<section class="card social-connections"><div class="card-head"><div><h2>Social accounts</h2><small>Connect the accounts that Marketing Center may publish to after your approval.</small></div><button class="btn" id="manageSocialAccounts">Manage connections</button></div><div class="social-account-grid">${providerKeys.map(key=>{const account=statuses[key],connected=account?.connected===true;return`<div class="social-account ${connected?'connected':'setup-needed'}"><span class="social-mark ${key}">${providers[key].mark}</span><div><strong>${providers[key].label}</strong><small>${connected?esc(account.name||'Connected'):providers[key].note}</small></div><em>${connected?'Connected':'Setup needed'}</em></div>`}).join('')}</div></section>`
 }

 function openSocialConnections(){
  const statuses=connectedStatus();
  $('#modalKicker').textContent='SOCIAL PUBLISHING';
  $('#modalTitle').textContent='Connect social accounts';
  $('#modalForm').innerHTML=`<div class="social-connection-list">${providerKeys.map(key=>{const provider=providers[key],account=statuses[key],connected=account?.connected===true;return`<article class="social-connect-row"><span class="social-mark ${key}">${provider.mark}</span><div><strong>${provider.label}</strong><small>${connected?`Connected as ${esc(account.name||provider.note)}`:provider.note}</small></div>${connected?`<button type="button" class="btn social-disconnect" data-provider="${key}">Disconnect</button>`:`<button type="button" class="btn primary social-connect" data-provider="${key}">Begin setup</button>`}</article>`}).join('')}</div><div class="social-security-note"><strong>Secure connection required</strong><p>Each platform must first approve this CRM as an application. Passwords are never entered or saved here. Until that approval is complete, Marketing Center will prepare and schedule campaigns but will not claim they were published.</p></div><div class="form-actions"><button type="button" class="btn" id="closeSocialConnections">Close</button></div>`;
  $('#modal').classList.remove('hidden');
  $('#closeSocialConnections').onclick=closeModal;
  $$('.social-connect').forEach(button=>button.onclick=()=>{const key=button.dataset.provider;if(window.crmSocialPublishing?.connect)return window.crmSocialPublishing.connect(key);window.open(providers[key].setup,'_blank','noopener');toast(`${providers[key].label} developer setup opened`)});
  $$('.social-disconnect').forEach(button=>button.onclick=async()=>{if(!confirm(`Disconnect ${platformLabel(button.dataset.provider)} from Marketing Center?`))return;await window.crmSocialPublishing?.disconnect?.(button.dataset.provider);openSocialConnections()})
 }

 const originalOpenMarketingItem=openMarketingItem;
 openMarketingItem=function(item={}){
  originalOpenMarketingItem(item);
  const grid=$('#modalForm .form-grid'),notes=$('#modalForm textarea[name="notes"]')?.closest('.field');
  if(!grid||!notes)return;
  notes.insertAdjacentHTML('beforebegin',`<fieldset class="field full social-platform-picker"><legend>Publish to</legend><div>${platformChecks(item)}</div><small>Select every platform that should receive this campaign.</small></fieldset><label class="field full"><span>Photo or video URL</span><input name="asset_url" type="url" value="${esc(item.asset_url||'')}" placeholder="https://…"><small>The final media must be available online before automatic publishing.</small></label>${platformCaptions(item)}`);
  const status=$('#modalForm select[name="status"]');
  if(status)status.insertAdjacentHTML('afterend','<small>Choose Ready for Review when the captions and media are complete. Publishing still requires a final confirmation.</small>');
  const syncCaptionFields=()=>{$$('[data-social-caption]',grid).forEach(field=>field.hidden=!$(`input[name="platforms"][value="${field.dataset.socialCaption}"]`,grid)?.checked)};
  $$('input[name="platforms"]',grid).forEach(input=>input.onchange=syncCaptionFields);
  const priorSubmit=$('#modalForm').onsubmit;
  $('#modalForm').onsubmit=async event=>{
   event.preventDefault();event.stopImmediatePropagation();
   const form=new FormData(event.currentTarget),platforms=form.getAll('platforms'),platform_captions=Object.fromEntries(platforms.map(key=>[key,String(form.get(`caption_${key}`)||'').trim()])),editing=Boolean(item.id),payload={title:String(form.get('title')||'').trim(),listing_id:Number(form.get('listing_id'))||null,channel:form.get('channel'),status:form.get('status'),scheduled_at:form.get('scheduled_at')||null,content:String(form.get('content')||'').trim(),notes:String(form.get('notes')||'').trim(),platforms,platform_captions,asset_url:String(form.get('asset_url')||'').trim(),publishing_approval:'not_approved'};
   await api(editing?`/marketing_items/${item.id}`:'/marketing_items',{method:editing?'PUT':'POST',body:JSON.stringify(payload)});closeModal();toast(editing?'Marketing campaign updated':'Campaign added to Marketing Center');go('marketing')
  };
 };

 function openPublishReview(item){
  const platforms=itemPlatforms(item),connections=connectedStatus(),missing=platforms.filter(key=>!connections[key]?.connected),captions=item.platform_captions||{};
  $('#modalKicker').textContent='FINAL APPROVAL';$('#modalTitle').textContent='Review before publishing';
  $('#modalForm').innerHTML=`<section class="social-publish-review"><h3>${esc(item.title)}</h3>${platforms.length?platforms.map(key=>`<article><div><span class="social-mark ${key}">${providers[key].mark}</span><strong>${providers[key].label}</strong>${connections[key]?.connected?'<em class="connected">Connected</em>':'<em>Not connected</em>'}</div><p>${esc(captions[key]||item.content||'No caption added.')}</p></article>`).join(''):'<p>No social platforms are selected for this campaign.</p>'}${item.asset_url?`<p><strong>Media:</strong> <a href="${esc(item.asset_url)}" target="_blank" rel="noopener">Preview file</a></p>`:'<p class="warning"><strong>Media is missing.</strong> Add a photo or video URL before publishing.</p>'}${missing.length?`<p class="warning"><strong>Connection required:</strong> ${missing.map(platformLabel).join(', ')}</p>`:''}<label class="social-approval"><input type="checkbox" id="socialPublishApproval"> I reviewed the captions, media, accounts, and scheduled time.</label></section><div class="form-actions"><button type="button" class="btn" id="cancelSocialPublish">Cancel</button><button type="button" class="btn" id="editSocialCampaign">Edit campaign</button><button type="button" class="btn primary" id="confirmSocialPublish" ${!platforms.length||missing.length||!item.asset_url?'disabled':''}>${item.scheduled_at?'Approve scheduled publishing':'Approve and publish'}</button></div>`;
  $('#modal').classList.remove('hidden');$('#cancelSocialPublish').onclick=closeModal;$('#editSocialCampaign').onclick=()=>{closeModal();openMarketingItem(item)};
  const button=$('#confirmSocialPublish'),approval=$('#socialPublishApproval');approval.onchange=()=>button.disabled=!approval.checked||missing.length>0||!platforms.length||!item.asset_url;
  button.onclick=async()=>{if(!approval.checked)return;button.disabled=true;button.textContent='Publishing…';try{if(!window.crmSocialPublishing?.publish)throw Error('Secure account publishing has not been activated yet. Open Manage connections to finish platform approval.');const results=await window.crmSocialPublishing.publish(item);await api(`/marketing_items/${item.id}`,{method:'PUT',body:JSON.stringify({status:item.scheduled_at?'Scheduled':'Published',publishing_approval:'approved',published_at:item.scheduled_at?null:new Date().toISOString(),publish_results:results})});closeModal();toast(item.scheduled_at?'Campaign approved and scheduled':'Campaign published');go('marketing')}catch(error){button.disabled=false;button.textContent=item.scheduled_at?'Approve scheduled publishing':'Approve and publish';toast(error.message||'Publishing did not finish',true)}}
 }

 const originalMarketingView=views.marketing;
 views.marketing=async()=>{
  await originalMarketingView();
  const pagehead=$('.pagehead'),metrics=$('.marketing-metrics'),items=state.data.marketing_items||[];
  if(pagehead)pagehead.querySelector('p').textContent='Prepare platform-specific campaigns, review every post, and publish only after final approval.';
  if(metrics)metrics.insertAdjacentHTML('beforebegin',socialConnectionHtml());
  $('#manageSocialAccounts')?.addEventListener('click',openSocialConnections);
  $$('.marketing-card').forEach(card=>{const id=Number(card.querySelector('.marketing-edit')?.dataset.marketingId),item=items.find(candidate=>Number(candidate.id)===id);if(!item)return;const platforms=itemPlatforms(item);if(platforms.length)card.querySelector('.marketing-card-top')?.insertAdjacentHTML('afterend',`<div class="social-chip-row">${platforms.map(key=>`<span class="social-chip ${key}">${providers[key].mark} ${providers[key].label}</span>`).join('')}</div>`);const actions=card.querySelector('.marketing-actions');if(actions&&['Ready for Review','Scheduled'].includes(item.status)){actions.querySelector('.marketing-published')?.remove();actions.insertAdjacentHTML('beforeend',`<button class="btn primary social-publish" data-marketing-id="${item.id}">${item.scheduled_at?'Review schedule':'Review & publish'}</button>`)}});
  $$('.social-publish').forEach(button=>button.onclick=()=>openPublishReview(items.find(item=>Number(item.id)===Number(button.dataset.marketingId))))
 };
 window.crmMarketing={openSocialConnections,openPublishReview};
 window.addEventListener('load',()=>{if(location.hash.slice(1).split('?')[0]==='marketing')go('marketing')},{once:true});
})();
