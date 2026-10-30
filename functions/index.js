'use strict';
const {onRequest}=require('firebase-functions/v2/https');
const {defineSecret,defineString}=require('firebase-functions/params');
const {initializeApp}=require('firebase-admin/app');
const {getAuth}=require('firebase-admin/auth');
const OpenAI=require('openai');
initializeApp();
const OPENAI_API_KEY=defineSecret('OPENAI_API_KEY');
const OPENAI_MODEL=defineString('OPENAI_MODEL',{default:'gpt-5-mini'});
const allowedOrigins=['https://erichepple7.github.io','http://127.0.0.1:8765','http://localhost:8765'];
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
