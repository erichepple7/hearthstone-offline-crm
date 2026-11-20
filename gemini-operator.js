(function(root){
  'use strict';

  const SDK='https://www.gstatic.com/firebasejs/12.19.0';
  const MODEL='gemini-3.8-flash';
  const APP_CHECK_KEY='crm_firebase_app_check_site_key';
  const PRODUCTION_APP_CHECK_SITE_KEY='6LfyJykuAAAAALHDZUnXOwjJ1K2hZ2mjXlb3DJxQ';
  let modelPromise=null;

  const clean=value=>String(value??'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,1200);
  const compactRecord=record=>Object.fromEntries(Object.entries(record||{}).filter(([key,value])=>{
    if(['data','document_data','gallery_urls','hero_image_url'].includes(key))return false;
    return value===null||['string','number','boolean'].includes(typeof value)||Array.isArray(value)&&value.length<30;
  }).map(([key,value])=>[key,typeof value==='string'?value.slice(0,2000):value]));

  function currentScreen(){
    const context=(typeof state!=='undefined'?state?.havenContext:null)||{};
    let record=null;
    try{record=typeof havenContextRecord==='function'?havenContextRecord():null}catch(error){record=null}
    return {kind:context.kind||'view',id:Number(context.id)||null,record:compactRecord(record)};
  }

  function setupReply(message){
    return {
      html:`<p><strong>Gemini is installed, but its Firebase connection needs attention.</strong></p><p>${message}</p><p>Open Firebase Console for <strong>hearthstone-real-estate-crm</strong>, enable Firebase AI Logic with the Gemini Developer API, and confirm App Check is configured for this web app.</p><p class="assistant-ai-source">No CRM records were changed.</p>`,
      action:'',
      source:'gemini-setup'
    };
  }

  async function createModel(){
    if(!root.crmFirebaseConfig)throw new Error('The CRM Firebase configuration is not ready. Refresh the page and try again.');
    const [appModule,aiModule,appCheckModule]=await Promise.all([
      import(`${SDK}/firebase-app.js`),
      import(`${SDK}/firebase-ai.js`),
      import(`${SDK}/firebase-app-check.js`)
    ]);
    let app;
    try{app=appModule.getApp('gemini-haven')}catch(error){app=appModule.initializeApp(root.crmFirebaseConfig,'gemini-haven')}
    // Always prefer the registered production key. Older setup attempts may have
    // left a mistyped key in one device's local storage (especially an iPhone PWA).
    const siteKey=root.crmFirebaseAppCheckSiteKey||PRODUCTION_APP_CHECK_SITE_KEY;
    if(localStorage.getItem(APP_CHECK_KEY)!==siteKey)localStorage.setItem(APP_CHECK_KEY,siteKey);
    if(siteKey){
      let appCheck;
      try{appCheck=appCheckModule.initializeAppCheck(app,{provider:new appCheckModule.ReCaptchaEnterpriseProvider(siteKey),isTokenAutoRefreshEnabled:true})}catch(error){if(!/already exists/i.test(String(error?.message||'')))throw error;appCheck=appCheckModule.getAppCheck(app)}
      await appCheckModule.getToken(appCheck,false);
    }
    const fieldSchema=aiModule.Schema.object({properties:{name:aiModule.Schema.string(),value:aiModule.Schema.string()}});
    const actionSchema=aiModule.Schema.object({
      properties:{
        type:aiModule.Schema.enumString({enum:['task','activity','contact_update','listing_update','transaction_update']}),
        target_id:aiModule.Schema.number(),
        target_label:aiModule.Schema.string(),
        summary:aiModule.Schema.string(),
        fields:aiModule.Schema.array({items:fieldSchema})
      },
      optionalProperties:['target_id','target_label']
    });
    const responseSchema=aiModule.Schema.object({properties:{
      answer:aiModule.Schema.string(),
      reasoning_summary:aiModule.Schema.string(),
      evidence:aiModule.Schema.array({items:aiModule.Schema.string()}),
      confidence:aiModule.Schema.enumString({enum:['high','medium','low']}),
      proposed_actions:aiModule.Schema.array({items:actionSchema})
    }});
    const ai=aiModule.getAI(app,{backend:new aiModule.GoogleAIBackend()});
    return aiModule.getGenerativeModel(ai,{
      model:MODEL,
      systemInstruction:`You are Haven, the operational intelligence inside Eric Hepple's private real-estate CRM. Your reasoning is powered by Gemini. You are not merely a fact finder or day planner. Read the user's instruction, understand the active CRM record and linked records, then prepare the exact CRM action requested.

Rules:
- Use only IDs and facts in the supplied CRM context. Never invent a contact, listing, transaction, date, or record ID.
- If the request is a direct command, propose the change instead of explaining how the user could do it.
- Never say a change was saved. You prepare proposed_actions; the CRM presents each action for Eric to review before saving.
- Ask one concise clarification only when the target record or a material detail is genuinely ambiguous.
- Treat the current_screen record as the target when the user says "this listing", "this transaction", or "this contact".
- Resolve relative dates using context.now and context.timezone. Use America/Chicago unless the context says otherwise.
- Respect the saved correction history and do not repeat a behavior Eric corrected.
- Keep answers concise, concrete, and action-oriented.

CRM actions:
- listing_update: target_id is the listing ID. Include only fields that should change.
- transaction_update and contact_update work the same way.
- task: use fields such as title, due_at, end_at, priority, notes, contact_id, listing_id, transaction_id.
- To add a showing to a listing, propose an activity action with fields: type=Showing, listing_id, occurred_at, end_at, showing_agent, showing_status, subject, body, and contact_id when a matching contact exists. If no duration is supplied, use one hour. The CRM will then add the approved showing to the listing, tasks, and calendar.
- ISO local date-time values must use YYYY-MM-DDTHH:mm without a trailing Z.

Return a useful answer plus evidence and every exact action required. If no action is requested, return an empty proposed_actions array.`,
      generationConfig:{responseMimeType:'application/json',responseSchema,temperature:0.15,maxOutputTokens:2200}
    });
  }

  function getModel(){
    if(!modelPromise)modelPromise=createModel().catch(error=>{modelPromise=null;throw error});
    return modelPromise;
  }

  async function ask({prompt,data,history=[],escape}){
    const base=root.CrmAssistantAI;
    if(!base?.compactContext||!base?.renderResult)return setupReply('The CRM reasoning layer did not finish loading. Refresh the page and try again.');
    const context={
      ...base.compactContext(prompt,data),
      current_screen:currentScreen(),
      conversation:(history||[]).slice(-8).map(item=>({role:item.role,content:clean(item.content)}))
    };
    try{
      const model=await getModel();
      const result=await model.generateContent(JSON.stringify({instruction:clean(prompt),context}));
      const payload=JSON.parse(result.response.text());
      const rendered=base.renderResult(payload,escape);
      return {...rendered,source:'gemini'};
    }catch(error){
      console.error('Gemini operator:',error);
      const detail=String(error?.message||'');
      if(/app.?check|permission|403|not found|api.*enabled|unauthorized|forbidden/i.test(detail))return setupReply('Firebase AI Logic or App Check has not finished authorizing this device.');
      if(/network|fetch|offline/i.test(detail))return setupReply('This device could not reach Gemini. Check the internet connection and try again.');
      return setupReply('Gemini could not complete this request. Refresh the CRM and try once more.');
    }
  }

  function configured(){return true}
  root.CrmGeminiOperator={ask,configured,model:MODEL,setAppCheckSiteKey:()=>{localStorage.setItem(APP_CHECK_KEY,PRODUCTION_APP_CHECK_SITE_KEY);modelPromise=null}};
  root.CrmAssistantAI={...root.CrmAssistantAI,ask,configured};
})(typeof globalThis!=='undefined'?globalThis:this);
