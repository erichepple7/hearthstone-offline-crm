/* Make contact next_follow_up the mirror of the earliest open linked task. */
(() => {
 const baseApi=api,mirrorKey=id=>`contact-next-follow-up:${Number(id)}`,dateKey=value=>String(value||'').slice(0,10);
 let reconciling=false;
 const openTasks=tasks=>tasks.filter(task=>!task._calendar&&task.status==='open'&&task.due_at).sort((a,b)=>String(a.due_at).localeCompare(String(b.due_at))||Number(a.id)-Number(b.id));
 async function records(){const [contacts,tasks]=await Promise.all([baseApi('/contacts'),baseApi('/tasks')]);return{contacts,tasks}}
 async function setContactToEarliest(contactId,provided=null){
  const data=provided||await records(),contact=data.contacts.find(item=>Number(item.id)===Number(contactId));if(!contact)return;
  const next=openTasks(data.tasks.filter(task=>Number(task.contact_id)===Number(contactId)))[0],nextDate=next?dateKey(next.due_at):null,current=dateKey(contact.next_follow_up)||null;
  if(current!==nextDate)await baseApi(`/contacts/${contactId}`,{method:'PUT',body:JSON.stringify({next_follow_up:nextDate})});
  if(state.data.contacts){const local=state.data.contacts.find(item=>Number(item.id)===Number(contactId));if(local)local.next_follow_up=nextDate}
 }
 async function applyManualDate(contactId,requestedDate){
  const data=await records(),contact=data.contacts.find(item=>Number(item.id)===Number(contactId));if(!contact)return;
  const tasks=data.tasks.filter(task=>Number(task.contact_id)===Number(contactId)),ordered=openTasks(tasks),mirror=ordered.find(task=>task.automation_key===mirrorKey(contactId)),same=ordered.find(task=>dateKey(task.due_at)===requestedDate),nextTask=mirror||ordered[0];
  if(requestedDate&&!same){if(nextTask){const time=String(nextTask.due_at||'').slice(11,16)||'09:00';await baseApi(`/tasks/${nextTask.id}`,{method:'PUT',body:JSON.stringify({due_at:`${requestedDate}T${time}`})})}else{const values={title:'Contact follow-up',contact_id:Number(contactId),due_at:`${requestedDate}T09:00`,priority:'Medium',reminder_minutes:60,status:'open',notes:'Scheduled from the contact’s Next follow-up field.',automation_key:mirrorKey(contactId)};await baseApi('/tasks',{method:'POST',body:JSON.stringify(values)})}}
  if((!requestedDate||same)&&mirror)await baseApi(`/tasks/${mirror.id}`,{method:'DELETE'});
  await setContactToEarliest(contactId)
 }
 async function reconcileAll(){if(reconciling)return;reconciling=true;try{const data=await records();for(const contact of data.contacts){const tasks=data.tasks.filter(task=>Number(task.contact_id)===Number(contact.id)),same=contact.next_follow_up&&openTasks(tasks).some(task=>dateKey(task.due_at)===dateKey(contact.next_follow_up));if(contact.next_follow_up&&!same)await applyManualDate(contact.id,dateKey(contact.next_follow_up));else if(openTasks(tasks).length)await setContactToEarliest(contact.id,data)}}finally{reconciling=false}}
 api=async(path,options={})=>{
  const method=String(options.method||'GET').toUpperCase(),contactMatch=String(path).match(/^\/contacts\/(\d+)$/),planMatch=String(path).match(/^\/contacts\/(\d+)\/apply-plan$/),taskMatch=String(path).match(/^\/tasks\/(\d+)$/),payload=(()=>{try{return JSON.parse(options.body||'{}')}catch{return{}}})(),priorTask=taskMatch?(state.data.tasks||[]).find(task=>!task._calendar&&Number(task.id)===Number(taskMatch[1])):null,result=await baseApi(path,options);
  if(reconciling)return result;
  reconciling=true;
  try{
   if(contactMatch&&['POST','PUT'].includes(method)&&Object.prototype.hasOwnProperty.call(payload,'next_follow_up'))await applyManualDate(Number(contactMatch[1]),dateKey(payload.next_follow_up));
   else if(planMatch&&method==='POST')await setContactToEarliest(Number(planMatch[1]));
   else if(path==='/contacts'&&method==='POST'&&result?.id)await setContactToEarliest(Number(result.id));
   else if((path==='/tasks'&&method==='POST'||taskMatch&&['PUT','DELETE'].includes(method))&&(result?.contact_id||priorTask?.contact_id))await setContactToEarliest(Number(result?.contact_id||priorTask.contact_id));
  }finally{reconciling=false}
  return result
 };
 const start=()=>setTimeout(()=>reconcileAll().catch(console.error),1200);document.readyState==='loading'?document.addEventListener('DOMContentLoaded',start,{once:true}):start();
})();
