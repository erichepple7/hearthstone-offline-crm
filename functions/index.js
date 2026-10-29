'use strict';
const {onRequest}=require('firebase-functions/v2/https');
const {defineSecret,defineString}=require('firebase-functions/params');
const {initializeApp}=require('firebase-admin/app');
const {getAuth}=require('firebase-admin/auth');
const {getFirestore}=require('firebase-admin/firestore');
const {google}=require('googleapis');
const crypto=require('node:crypto');
const OpenAI=require('openai');
initializeApp();
const OPENAI_API_KEY=defineSecret('OPENAI_API_KEY');
const OPENAI_MODEL=defineString('OPENAI_MODEL',{default:'gpt-5-mini'});
const GMAIL_CLIENT_ID=defineSecret('GMAIL_CLIENT_ID');
const GMAIL_CLIENT_SECRET=defineSecret('GMAIL_CLIENT_SECRET');
const allowedOrigins=['https://erichepple7.github.io','http://127.0.0.1:8765','http://localhost:8765'];
const CRM_OWNER_EMAIL='erichepple7@gmail.com';
const CRM_URL='https://erichepple7.github.io/hearthstone-offline-crm/#inbox';
const GMAIL_CALLBACK_URL='https://us-central1-hearthstone-real-estate-crm.cloudfunctions.net/gmailOAuthCallback';
const system=`You are Eric Hepple's private CRM business advisor. Analyze only the CRM evidence in the supplied context. Think across contacts, tasks, activities, opportunities, listings, transactions, deadlines, and the user's saved corrections. Be concise, decisive, and useful. Distinguish facts from inference. Never invent a contact, date, amount, communication, status, or property fact. If evidence is missing or contradictory, say so and lower confidence. Never claim that anything was saved, sent, changed, deleted, or completed. You may propose at most one reviewable task. The user must approve every action. Saved corrections outrank general defaults. Return JSON only with these exact keys: answer (string), reasoning_summary (string), evidence (array of short strings), confidence (high, medium, or low), proposed_action (null or an object with type task, title, due_at, priority, notes, contact_id, listing_id, summary).`;
function originAllowed(origin){return !origin||allowedOrigins.includes(origin)}
function normalize(value){const payload=value&&typeof value==='object'?value:{};return {answer:String(payload.answer||'The available CRM evidence is not sufficient for a reliable recommendation.').slice(0,1200),reasoning_summary:String(payload.reasoning_summary||'').slice(0,1600),evidence:Array.isArray(payload.evidence)?payload.evidence.map(item=>String(item).slice(0,300)).slice(0,8):[],confidence:['high','medium','low'].includes(String(payload.confidence).toLowerCase())?String(payload.confidence).toLowerCase():'low',proposed_action:payload.proposed_action?.type==='task'?{type:'task',title:String(payload.proposed_action.title||'').slice(0,180),due_at:String(payload.proposed_action.due_at||''),priority:['High','Medium','Low'].includes(payload.proposed_action.priority)?payload.proposed_action.priority:'Medium',notes:String(payload.proposed_action.notes||'').slice(0,1000),contact_id:Number(payload.proposed_action.contact_id)||null,listing_id:Number(payload.proposed_action.listing_id)||null,summary:String(payload.proposed_action.summary||payload.proposed_action.title||'').slice(0,240)}:null}}
exports.crmAssistant=onRequest({region:'us-central1',cors:allowedOrigins,secrets:[OPENAI_API_KEY],timeoutSeconds:45,memory:'256MiB'},async(req,res)=>{
  res.set('Cache-Control','no-store');
  if(!originAllowed(req.get('origin')))return res.status(403).json({error:'This site is not allowed.'});
  if(req.method!=='POST')return res.status(405).json({error:'Use POST.'});
  try{
    const bearer=String(req.get('authorization')||'').match(/^Bearer\s+(.+)$/i)?.[1];
    if(!bearer)return res.status(401).json({error:'Sign in to the CRM first.'});
    const decoded=await getAuth().verifyIdToken(bearer);
    if(String(decoded.email||'').toLowerCase()!=='erichepple7@gmail.com')return res.status(403).json({error:'This account is not authorized.'});
    const context=req.body?.context;if(!context||typeof context!=='object')return res.status(400).json({error:'CRM context is required.'});
    const client=new OpenAI({apiKey:OPENAI_API_KEY.value()});
    const response=await client.responses.create({model:OPENAI_MODEL.value(),instructions:system,input:JSON.stringify(context),text:{format:{type:'json_schema',name:'crm_advice',strict:true,schema:{type:'object',additionalProperties:false,properties:{answer:{type:'string'},reasoning_summary:{type:'string'},evidence:{type:'array',items:{type:'string'}},confidence:{type:'string',enum:['high','medium','low']},proposed_action:{anyOf:[{type:'null'},{type:'object',additionalProperties:false,properties:{type:{type:'string',enum:['task']},title:{type:'string'},due_at:{type:'string'},priority:{type:'string',enum:['High','Medium','Low']},notes:{type:'string'},contact_id:{anyOf:[{type:'integer'},{type:'null'}]},listing_id:{anyOf:[{type:'integer'},{type:'null'}]},summary:{type:'string'}},required:['type','title','due_at','priority','notes','contact_id','listing_id','summary']}] }},required:['answer','reasoning_summary','evidence','confidence','proposed_action']}}}});
    let parsed;try{parsed=JSON.parse(response.output_text)}catch{throw new Error('The AI response could not be validated.')}return res.json(normalize(parsed));
  }catch(error){console.error('crmAssistant request failed',error?.name||'Error');return res.status(500).json({error:'Secure AI reasoning is temporarily unavailable. The offline advisor will continue to work.'})}
});

function gmailOauth(){return new google.auth.OAuth2(GMAIL_CLIENT_ID.value(),GMAIL_CLIENT_SECRET.value(),GMAIL_CALLBACK_URL)}
async function ownerFromRequest(req){
  const bearer=String(req.get('authorization')||'').match(/^Bearer\s+(.+)$/i)?.[1];
  if(!bearer)throw Object.assign(new Error('Sign in to the CRM first.'),{status:401});
  const decoded=await getAuth().verifyIdToken(bearer);
  if(String(decoded.email||'').toLowerCase()!==CRM_OWNER_EMAIL)throw Object.assign(new Error('This account is not authorized.'),{status:403});
  return decoded;
}
function gmailTokenRef(uid){return getFirestore().doc(`users/${uid}/private/gmail`)}
async function authorizedGmail(uid){
  const snapshot=await gmailTokenRef(uid).get();
  if(!snapshot.exists||!snapshot.data().refresh_token)throw Object.assign(new Error('Connect Gmail first.'),{status:409});
  const auth=gmailOauth();auth.setCredentials(snapshot.data());
  auth.on('tokens',tokens=>gmailTokenRef(uid).set({...tokens,updated_at:new Date().toISOString()},{merge:true}).catch(console.error));
  return {auth,settings:snapshot.data(),gmail:google.gmail({version:'v1',auth})};
}
function gmailError(res,error){console.error('Gmail integration request failed',error?.message||error);return res.status(error?.status||500).json({error:error?.status?error.message:'Gmail is temporarily unavailable. Try again.'})}
function gmailHeaders(payload={}){return Object.fromEntries((payload.headers||[]).map(item=>[String(item.name||'').toLowerCase(),String(item.value||'')]))}
function decodeGmailBody(data=''){try{return Buffer.from(String(data).replace(/-/g,'+').replace(/_/g,'/'),'base64').toString('utf8')}catch{return''}}
function stripHtml(text=''){return String(text).replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<br\s*\/?>/gi,'\n').replace(/<\/p>/gi,'\n').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/\n{3,}/g,'\n\n').replace(/[ \t]{2,}/g,' ').trim()}
function gmailBody(payload={}){
  const parts=[];const walk=part=>{if(part.mimeType==='text/plain'&&part.body?.data)parts.unshift(decodeGmailBody(part.body.data));else if(part.mimeType==='text/html'&&part.body?.data)parts.push(stripHtml(decodeGmailBody(part.body.data)));for(const child of part.parts||[])walk(child)};walk(payload);return String(parts.find(Boolean)||'').slice(0,12000);
}
function headerEmails(value=''){return [...String(value).matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map(match=>match[0].toLowerCase())}
function messageForCrm(message,contactMap){
  const headers=gmailHeaders(message.payload),from=headerEmails(headers.from),to=[...headerEmails(headers.to),...headerEmails(headers.cc)],all=[...new Set([...from,...to])],contactEmail=all.find(email=>email!==CRM_OWNER_EMAIL&&contactMap.has(email));
  if(!contactEmail)return null;
  const direction=from.includes(CRM_OWNER_EMAIL)?'Outgoing':'Incoming',contact=contactMap.get(contactEmail);
  return {contact_id:contact.id,email:contactEmail,message_id:message.id,thread_id:message.threadId,direction,subject:headers.subject||'(No subject)',body:gmailBody(message.payload)||message.snippet||'',from:headers.from||'',to:headers.to||'',occurred_at:new Date(Number(message.internalDate)||Date.now()).toISOString(),in_reply_to:headers['message-id']||''};
}
async function fetchGmailMessages(gmail,settings,initialDays=90){
  const ids=new Set();let latestHistoryId=settings.last_sync_at?(settings.history_id||''):'';
  if(settings.history_id&&settings.last_sync_at){
    try{let pageToken;do{const result=await gmail.users.history.list({userId:'me',startHistoryId:String(settings.history_id),historyTypes:['messageAdded'],maxResults:500,pageToken});for(const history of result.data.history||[])for(const added of history.messagesAdded||[])if(added.message?.id)ids.add(added.message.id);latestHistoryId=result.data.historyId||latestHistoryId;pageToken=result.data.nextPageToken}while(pageToken)}catch(error){if(error.code!==404)throw error;latestHistoryId=''}
  }
  if(!settings.history_id||!latestHistoryId){let pageToken,pages=0;do{const result=await gmail.users.messages.list({userId:'me',q:`newer_than:${Math.max(1,Math.min(365,Number(initialDays)||90))}d`,maxResults:100,pageToken});for(const item of result.data.messages||[])ids.add(item.id);pageToken=result.data.nextPageToken;pages++}while(pageToken&&pages<5);const profile=await gmail.users.getProfile({userId:'me'});latestHistoryId=profile.data.historyId||latestHistoryId}
  const messages=[];for(const id of [...ids].slice(0,500)){const result=await gmail.users.messages.get({userId:'me',id,format:'full'});messages.push(result.data)}return {messages,historyId:latestHistoryId};
}

exports.gmailConnect=onRequest({region:'us-central1',cors:allowedOrigins,secrets:[GMAIL_CLIENT_ID,GMAIL_CLIENT_SECRET]},async(req,res)=>{
  res.set('Cache-Control','no-store');if(req.method!=='POST')return res.status(405).json({error:'Use POST.'});
  try{const owner=await ownerFromRequest(req),nonce=crypto.randomBytes(24).toString('hex');await getFirestore().doc(`users/${owner.uid}/gmail_oauth/${nonce}`).set({created_at:Date.now(),email:CRM_OWNER_EMAIL});const auth=gmailOauth(),url=auth.generateAuthUrl({access_type:'offline',prompt:'consent',include_granted_scopes:true,state:`${owner.uid}:${nonce}`,scope:['https://www.googleapis.com/auth/gmail.send','https://www.googleapis.com/auth/gmail.readonly']});return res.json({url})}catch(error){return gmailError(res,error)}
});
exports.gmailOAuthCallback=onRequest({region:'us-central1',secrets:[GMAIL_CLIENT_ID,GMAIL_CLIENT_SECRET]},async(req,res)=>{
  res.set('Cache-Control','no-store');
  try{const [uid,nonce]=String(req.query.state||'').split(':'),stateRef=getFirestore().doc(`users/${uid}/gmail_oauth/${nonce}`),state=await stateRef.get();if(!uid||!nonce||!state.exists||Date.now()-Number(state.data().created_at)>10*60*1000)throw Object.assign(new Error('This Gmail connection request expired. Start again from the CRM.'),{status:400});if(req.query.error)throw Object.assign(new Error(`Google did not connect Gmail: ${req.query.error}`),{status:400});const auth=gmailOauth(),{tokens}=await auth.getToken(String(req.query.code||''));auth.setCredentials(tokens);const gmail=google.gmail({version:'v1',auth}),profile=await gmail.users.getProfile({userId:'me'});if(String(profile.data.emailAddress||'').toLowerCase()!==CRM_OWNER_EMAIL)throw Object.assign(new Error(`Connect ${CRM_OWNER_EMAIL}, not another Google account.`),{status:403});const existing=await gmailTokenRef(uid).get(),refreshToken=tokens.refresh_token||existing.data()?.refresh_token;if(!refreshToken)throw Object.assign(new Error('Google did not return long-term permission. Disconnect the app in Google Account settings and try again.'),{status:400});await gmailTokenRef(uid).set({...tokens,refresh_token:refreshToken,email:CRM_OWNER_EMAIL,history_id:profile.data.historyId||'',connected_at:new Date().toISOString(),updated_at:new Date().toISOString()},{merge:true});await stateRef.delete();return res.status(200).send(`<!doctype html><meta name="viewport" content="width=device-width"><title>Gmail connected</title><style>body{font-family:system-ui;background:#f5f1ea;color:#4d4842;display:grid;place-items:center;min-height:100vh;margin:0}.card{background:white;border:1px solid #d8cec0;border-radius:16px;padding:32px;max-width:520px;text-align:center}a{display:inline-block;margin-top:16px;padding:12px 18px;border-radius:9px;background:#6b635b;color:white;text-decoration:none;font-weight:700}</style><div class="card"><h1>Gmail connected</h1><p>${CRM_OWNER_EMAIL} is ready to use inside the CRM.</p><a href="${CRM_URL}">Return to the CRM</a></div><script>try{window.opener&&window.opener.postMessage({type:'hearthstone-gmail-connected'},'https://erichepple7.github.io');setTimeout(()=>window.close(),700)}catch(e){}</script>`)}catch(error){console.error(error);return res.status(error.status||500).send(`<h1>Gmail was not connected</h1><p>${String(error.message||'Try again from the CRM.')}</p><p><a href="${CRM_URL}">Return to the CRM</a></p>`)}
});
exports.gmailStatus=onRequest({region:'us-central1',cors:allowedOrigins,secrets:[GMAIL_CLIENT_ID,GMAIL_CLIENT_SECRET]},async(req,res)=>{res.set('Cache-Control','no-store');try{const owner=await ownerFromRequest(req),snapshot=await gmailTokenRef(owner.uid).get();return res.json({connected:snapshot.exists&&Boolean(snapshot.data().refresh_token),email:snapshot.data()?.email||'',connected_at:snapshot.data()?.connected_at||'',last_sync_at:snapshot.data()?.last_sync_at||''})}catch(error){return gmailError(res,error)}});
exports.gmailDisconnect=onRequest({region:'us-central1',cors:allowedOrigins,secrets:[GMAIL_CLIENT_ID,GMAIL_CLIENT_SECRET]},async(req,res)=>{res.set('Cache-Control','no-store');try{const owner=await ownerFromRequest(req),snapshot=await gmailTokenRef(owner.uid).get(),token=snapshot.data()?.refresh_token;if(token)try{await gmailOauth().revokeToken(token)}catch(error){console.warn('Gmail token revoke failed',error?.message)}await gmailTokenRef(owner.uid).delete();return res.json({disconnected:true})}catch(error){return gmailError(res,error)}});
exports.gmailSync=onRequest({region:'us-central1',cors:allowedOrigins,secrets:[GMAIL_CLIENT_ID,GMAIL_CLIENT_SECRET],timeoutSeconds:120,memory:'512MiB'},async(req,res)=>{res.set('Cache-Control','no-store');if(req.method!=='POST')return res.status(405).json({error:'Use POST.'});try{const owner=await ownerFromRequest(req),contacts=Array.isArray(req.body?.contacts)?req.body.contacts.slice(0,500):[],contactMap=new Map(contacts.map(contact=>[String(contact.email||'').trim().toLowerCase(),{id:Number(contact.id),email:String(contact.email||'').trim().toLowerCase()}]).filter(([email,contact])=>email&&contact.id)),{gmail,settings}=await authorizedGmail(owner.uid),result=await fetchGmailMessages(gmail,settings,Number(req.body?.initial_days)||90),messages=result.messages.map(message=>messageForCrm(message,contactMap)).filter(Boolean).sort((a,b)=>String(a.occurred_at).localeCompare(String(b.occurred_at)));await gmailTokenRef(owner.uid).set({history_id:result.historyId,last_sync_at:new Date().toISOString(),updated_at:new Date().toISOString()},{merge:true});return res.json({messages,last_sync_at:new Date().toISOString()})}catch(error){return gmailError(res,error)}});
exports.gmailSend=onRequest({region:'us-central1',cors:allowedOrigins,secrets:[GMAIL_CLIENT_ID,GMAIL_CLIENT_SECRET],timeoutSeconds:60},async(req,res)=>{res.set('Cache-Control','no-store');if(req.method!=='POST')return res.status(405).json({error:'Use POST.'});try{const owner=await ownerFromRequest(req),to=String(req.body?.to||'').trim(),subject=String(req.body?.subject||'').trim().slice(0,500),body=String(req.body?.body||'').slice(0,50000);if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to))return res.status(400).json({error:'Add a valid contact email address.'});if(!subject||!body)return res.status(400).json({error:'Add a subject and message before sending.'});const {gmail}=await authorizedGmail(owner.uid),encodedSubject=`=?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,headers=[`From: ${CRM_OWNER_EMAIL}`,`To: ${to}`,`Subject: ${encodedSubject}`,'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: 8bit'];if(req.body?.in_reply_to){headers.push(`In-Reply-To: ${String(req.body.in_reply_to).replace(/[\r\n]/g,'')}`);headers.push(`References: ${String(req.body.in_reply_to).replace(/[\r\n]/g,'')}`)}const raw=Buffer.from(`${headers.join('\r\n')}\r\n\r\n${body}`).toString('base64url'),sent=await gmail.users.messages.send({userId:'me',requestBody:{raw,threadId:req.body?.thread_id||undefined}}),full=await gmail.users.messages.get({userId:'me',id:sent.data.id,format:'metadata',metadataHeaders:['Message-ID']});return res.json({message_id:sent.data.id,thread_id:sent.data.threadId,occurred_at:new Date(Number(full.data.internalDate)||Date.now()).toISOString(),in_reply_to:gmailHeaders(full.data.payload)['message-id']||''})}catch(error){return gmailError(res,error)}});
