const GMAIL_FUNCTION_BASE='https://us-central1-hearthstone-real-estate-crm.cloudfunctions.net';
const GMAIL_SYNC_INTERVAL=10*60*1000;
const crmGmail={connected:false,email:'',lastSyncAt:'',busy:false,statusLoaded:false};
window.crmGmail=crmGmail;

async function gmailIdToken(){
  const user=window.firebase?.auth?.().currentUser;
  if(!user)throw Error('Sign in to CRM Sync before connecting Gmail.');
  return user.getIdToken();
}
async function gmailFunction(name,body={}){
  const token=await gmailIdToken(),response=await fetch(`${GMAIL_FUNCTION_BASE}/${name}`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify(body)}),data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(data.error||'Gmail could not complete that request.');
  return data;
}
async function gmailStatus({quiet=false}={}){
  try{const status=await gmailFunction('gmailStatus');Object.assign(crmGmail,status,{statusLoaded:true});renderGmailConnection();return status}catch(error){crmGmail.statusLoaded=true;crmGmail.connected=false;renderGmailConnection();if(!quiet)toast(error.message,true);return {connected:false}}
}
async function connectGmail(){
  try{const {url}=await gmailFunction('gmailConnect'),popup=window.open(url,'hearthstone-gmail-connect','popup,width=640,height=760');if(!popup)location.href=url;else toast(`Approve access to ${CRM_EMAIL_ACCOUNT}`)}catch(error){toast(error.message,true)}
}
async function disconnectGmail(){
  if(!confirm(`Disconnect ${CRM_EMAIL_ACCOUNT}? Existing CRM communication history will remain.`))return;
  try{await gmailFunction('gmailDisconnect');Object.assign(crmGmail,{connected:false,email:'',lastSyncAt:''});renderGmailConnection();toast('Gmail disconnected')}catch(error){toast(error.message,true)}
}
function gmailMessageKey(activity){return String(activity?.metadata?.gmail_message_id||'')}
async function syncGmail({manual=false}={}){
  if(crmGmail.busy||!crmGmail.connected||!navigator.onLine)return {imported:0};
  crmGmail.busy=true;renderGmailConnection();
  try{
    const contacts=await localApi('/contacts'),activities=await localApi('/activities'),notifications=await localApi('/notifications'),known=new Set(activities.map(gmailMessageKey).filter(Boolean)),notificationKeys=new Set(notifications.map(item=>item.source_id).filter(Boolean)),payload=await gmailFunction('gmailSync',{contacts:contacts.filter(contact=>String(contact.email||'').trim()).map(contact=>({id:contact.id,email:contact.email})),initial_days:90});let imported=0,incoming=0;
    for(const message of payload.messages||[]){
      if(known.has(message.message_id))continue;
      await localApi('/activities',{method:'POST',body:JSON.stringify({contact_id:Number(message.contact_id),type:'Email',direction:message.direction,subject:message.subject,body:message.body,occurred_at:message.occurred_at,metadata:{gmail_message_id:message.message_id,gmail_thread_id:message.thread_id,gmail_message_header:message.in_reply_to,gmail_synced:true,from:message.from,to:message.to}})});known.add(message.message_id);imported++;
      if(message.direction==='Incoming'&&!notificationKeys.has(`gmail-${message.message_id}`)){const contact=contacts.find(item=>Number(item.id)===Number(message.contact_id));await localApi('/notifications',{method:'POST',body:JSON.stringify({type:'gmail_reply',source_id:`gmail-${message.message_id}`,contact_id:Number(message.contact_id),title:`Email reply · ${contact?`${contact.first_name} ${contact.last_name}`.trim():'Contact'}`,message:message.subject||'New Gmail conversation',action_label:'Open contact',read:false,due_at:message.occurred_at})});notificationKeys.add(`gmail-${message.message_id}`);incoming++}
    }
    crmGmail.lastSyncAt=payload.last_sync_at||new Date().toISOString();localStorage.setItem('crm_gmail_last_sync',crmGmail.lastSyncAt);renderGmailConnection();
    if(typeof refreshNotifications==='function')await refreshNotifications();
    if(manual)toast(imported?`${imported} Gmail message${imported===1?'':'s'} added to contact history`:'Gmail is up to date');
    return {imported,incoming};
  }catch(error){if(manual)toast(error.message,true);return {imported:0,error}}
  finally{crmGmail.busy=false;renderGmailConnection()}
}
function gmailConnectionCard(){
  const connected=crmGmail.connected,last=crmGmail.lastSyncAt?fmtDateTime(crmGmail.lastSyncAt):'Not synced yet';
  return `<section class="card gmail-connection" id="gmailConnection"><div class="gmail-connection-copy"><div class="eyebrow">CONNECTED COMMUNICATIONS</div><h2>${connected?'Gmail is connected':'Connect Gmail'}</h2><p>${connected?`${esc(crmGmail.email||CRM_EMAIL_ACCOUNT)} sends from the CRM and matches conversations to Contacts.`:`Send email inside the CRM and keep contact conversations, Last contact, and follow-ups current.`}</p><small>${connected?`Last conversation sync: ${esc(last)} · Automatic check every 10 minutes`:'Your Google password is never stored in the CRM.'}</small></div><div class="gmail-connection-actions">${connected?`<button type="button" class="btn primary" id="gmailSyncNow" ${crmGmail.busy?'disabled':''}>${crmGmail.busy?'Syncing…':'Sync now'}</button><button type="button" class="btn" id="gmailDisconnect">Disconnect</button>`:`<button type="button" class="btn primary" id="gmailConnect">Connect ${CRM_EMAIL_ACCOUNT}</button>`}</div></section>`;
}
function renderGmailConnection(){
  const existing=$('#gmailConnection');if(!existing)return;existing.outerHTML=gmailConnectionCard();bindGmailConnection();
}
function bindGmailConnection(){
  if($('#gmailConnect'))$('#gmailConnect').onclick=connectGmail;
  if($('#gmailDisconnect'))$('#gmailDisconnect').onclick=disconnectGmail;
  if($('#gmailSyncNow'))$('#gmailSyncNow').onclick=()=>syncGmail({manual:true});
}
function addGmailConnectionCard(){
  const grid=$('.inbox-grid');if(!grid||$('#gmailConnection'))return;grid.insertAdjacentHTML('beforebegin',gmailConnectionCard());bindGmailConnection();
}
function defaultFollowUpDate(contact){
  if(contact.next_follow_up)return String(contact.next_follow_up).slice(0,10);
  const date=new Date();date.setDate(date.getDate()+7);return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
async function openCrmEmailComposer(contactId,{subject='',body='',draftId=null,linkedTaskId=null}={}){
  await load('contacts','activities','tasks','communication_drafts');const contact=(state.data.contacts||[]).find(item=>Number(item.id)===Number(contactId));if(!contact)return toast('Contact not found',true);if(!contact.email)return toast('Add an email address to this contact first',true);
  if(!crmGmail.connected){closeModal();go('inbox');setTimeout(()=>toast(`Connect ${CRM_EMAIL_ACCOUNT} before sending from the CRM`,true),250);return}
  const emailHistory=(state.data.activities||[]).filter(item=>Number(item.contact_id)===Number(contact.id)&&item.type==='Email'&&item.metadata?.gmail_thread_id).sort((a,b)=>String(b.occurred_at||b.created_at||'').localeCompare(String(a.occurred_at||a.created_at||''))),latest=emailHistory[0],replySubject=subject||(latest?.subject?(/^re:/i.test(latest.subject)?latest.subject:`Re: ${latest.subject}`):''),followUp=defaultFollowUpDate(contact);
  $('#modalKicker').textContent='GMAIL · REVIEW BEFORE SENDING';$('#modalTitle').textContent=`Email ${contact.first_name||contact.email}`;$('#modalForm').innerHTML=`<div class="form-grid gmail-composer"><div class="field full gmail-send-from"><span>From</span><strong>${CRM_EMAIL_ACCOUNT}</strong></div><div class="field full"><span>To</span><strong>${esc(contact.email)}</strong></div><label class="field full"><span>Subject</span><input id="gmailSubject" value="${esc(replySubject)}"></label><label class="field full"><span>Message</span><textarea id="gmailBody" rows="10">${esc(body)}</textarea></label><label class="field"><span>Next follow-up</span><input id="gmailNextFollowUp" type="date" value="${esc(followUp)}"></label><div class="field gmail-thread-note"><span>Conversation</span><small>${latest?'Reply in the most recent Gmail thread.':'Start a new Gmail conversation.'}</small></div><div class="field full"><small>Nothing is sent until you press Send email now. Sending records this email under the contact, updates Last contact, completes the linked task when applicable, and saves the follow-up date above.</small></div><div class="form-actions"><button type="button" class="btn" id="gmailCancelSend">Cancel</button><button type="button" class="btn primary" id="gmailSendNow">Send email now</button></div></div>`;$('#modal').classList.remove('hidden');document.body.classList.add('modal-open');$('#gmailCancelSend').onclick=closeModal;$('#gmailSendNow').onclick=async()=>{const button=$('#gmailSendNow'),emailSubject=$('#gmailSubject').value.trim(),emailBody=$('#gmailBody').value.trim(),nextFollowUp=$('#gmailNextFollowUp').value;if(!emailSubject||!emailBody)return toast('Add a subject and message before sending',true);if(!confirm(`Send this email now from ${CRM_EMAIL_ACCOUNT} to ${contact.email}?`))return;button.disabled=true;button.textContent='Sending…';try{const sent=await gmailFunction('gmailSend',{to:contact.email,subject:emailSubject,body:emailBody,thread_id:latest?.metadata?.gmail_thread_id||'',in_reply_to:latest?.metadata?.gmail_message_header||''}),sentAt=sent.occurred_at||new Date().toISOString();await localApi('/activities',{method:'POST',body:JSON.stringify({contact_id:contact.id,type:'Email',direction:'Outgoing',subject:emailSubject,body:emailBody,occurred_at:sentAt,metadata:{gmail_message_id:sent.message_id,gmail_thread_id:sent.thread_id,gmail_message_header:sent.in_reply_to,gmail_sent_from_crm:true,draft_id:draftId||null,task_id:linkedTaskId||null}})});if(draftId)await localApi(`/communication_drafts/${draftId}`,{method:'PUT',body:JSON.stringify({status:'sent',sent_at:sentAt,subject:emailSubject,body:emailBody})});if(linkedTaskId){const task=(state.data.tasks||[]).find(item=>Number(item.id)===Number(linkedTaskId));if(task?.status==='open')await localApi(`/tasks/${linkedTaskId}`,{method:'PUT',body:JSON.stringify({status:'completed',completed_at:sentAt})})}if(nextFollowUp)await localApi(`/contacts/${contact.id}`,{method:'PUT',body:JSON.stringify({next_follow_up:nextFollowUp,last_contact:sentAt})});closeModal();toast('Email sent and contact history updated');if(state.view==='inbox')go('inbox');else if(state.contact?.id===contact.id)showContact(contact.id)}catch(error){button.disabled=false;button.textContent='Send email now';toast(error.message,true)}};
}

const inboxBeforeGmail=views.inbox;
views.inbox=async()=>{await inboxBeforeGmail();addGmailConnectionCard();if(!crmGmail.statusLoaded)gmailStatus({quiet:true})};
document.addEventListener('click',event=>{
  const contactLink=event.target.closest('[data-gmail-contact]');if(!contactLink)return;
  const channel=$('#reviewChannel')?.value;if(contactLink.id==='openDraftApp'&&channel&&channel!=='Email')return;
  event.preventDefault();event.stopImmediatePropagation();
  const contactId=Number(contactLink.dataset.gmailContact),subject=$('#reviewSubject')?.value||'',body=$('#reviewBody')?.value||'',draftId=Number(contactLink.dataset.draftId)||null,linkedTaskId=Number(contactLink.dataset.linkedTaskId)||null;
  openCrmEmailComposer(contactId,{subject,body,draftId,linkedTaskId});
},true);
window.addEventListener('message',event=>{if(event.origin!==GMAIL_FUNCTION_BASE||event.data?.type!=='hearthstone-gmail-connected')return;gmailStatus().then(status=>status.connected&&syncGmail({manual:true}))});
window.addEventListener('online',()=>crmGmail.connected&&syncGmail());
window.addEventListener('pageshow',()=>gmailStatus({quiet:true}).then(status=>status.connected&&syncGmail()));
setInterval(()=>crmGmail.connected&&document.visibilityState==='visible'&&syncGmail(),GMAIL_SYNC_INTERVAL);
function bindGmailAuthWhenReady(attempt=0){
  if(window.firebase?.auth&&firebase.apps?.length){
    firebase.auth().onAuthStateChanged(user=>{if(!user){Object.assign(crmGmail,{connected:false,email:'',lastSyncAt:'',statusLoaded:true});renderGmailConnection();return}gmailStatus({quiet:true}).then(status=>status.connected&&syncGmail())});
    return;
  }
  if(attempt<50)setTimeout(()=>bindGmailAuthWhenReady(attempt+1),100);
}
bindGmailAuthWhenReady();
function ensureGmailConnectionCard(attempt=0){
  if(state.view!=='inbox')return;
  if($('.inbox-grid')){addGmailConnectionCard();return}
  if(attempt<30)setTimeout(()=>ensureGmailConnectionCard(attempt+1),100);
}
setTimeout(()=>ensureGmailConnectionCard(),0);
