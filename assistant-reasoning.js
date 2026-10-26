(function(root){
  const DAY=86400000;
  const dateKey=value=>String(value||'').slice(0,10);
  const atNoon=value=>{const key=dateKey(value);return key?new Date(`${key}T12:00:00`):null};
  const daysBetween=(from,to)=>Math.round((to-from)/DAY);
  const nameOf=contact=>`${contact?.first_name||''} ${contact?.last_name||''}`.trim()||'Unnamed contact';
  const isOpen=value=>!['completed','cancelled','closed','done'].includes(String(value||'open').toLowerCase());

  function buildAssistantInsights(data={},nowValue=new Date()){
    const now=new Date(nowValue),today=new Date(now.getFullYear(),now.getMonth(),now.getDate(),12),todayKey=dateKey(today.toISOString());
    const contacts=data.contacts||[],tasks=data.tasks||[],transactions=data.transactions||[],listings=data.listings||[],opportunities=data.opportunities||[],activities=data.activities||[];
    const items=[],contactById=new Map(contacts.map(contact=>[Number(contact.id),contact]));
    const add=item=>items.push(item);

    for(const task of tasks){
      if(task._calendar||!isOpen(task.status)||!task.due_at)continue;
      const due=atNoon(task.due_at);if(!due)continue;
      const days=daysBetween(today,due),person=task.contact_name||nameOf(contactById.get(Number(task.contact_id))),context=person==='Unnamed contact'?'':` for ${person}`;
      if(days<0)add({score:110-days,title:task.title||'Untitled task',detail:`Overdue by ${Math.abs(days)} day${Math.abs(days)===1?'':'s'}${context}.`,reason:'Overdue commitments are the highest risk for missed client service.',route:'tasks',kind:'task',id:task.id});
      else if(days===0)add({score:105,title:task.title||'Untitled task',detail:`Due today${context}.`,reason:'This is due before the day ends.',route:'tasks',kind:'task',id:task.id});
      else if(days<=7)add({score:65-days,title:task.title||'Untitled task',detail:`Due in ${days} day${days===1?'':'s'}${context}.`,reason:'Preparing early reduces last-minute work.',route:'tasks',kind:'task',id:task.id});
    }

    for(const contact of contacts){
      if(!contact.next_follow_up)continue;
      const due=atNoon(contact.next_follow_up);if(!due)continue;
      const days=daysBetween(today,due),name=nameOf(contact);
      if(days<0)add({score:102-days,title:`Follow up with ${name}`,detail:`Follow-up is ${Math.abs(days)} day${Math.abs(days)===1?'':'s'} overdue.`,reason:'A promised follow-up is waiting and can affect trust.',route:'contacts',kind:'contact',id:contact.id});
      else if(days===0)add({score:100,title:`Follow up with ${name}`,detail:'Follow-up is due today.',reason:'This contact is scheduled for attention today.',route:'contacts',kind:'contact',id:contact.id});
      else if(days<=3)add({score:62-days,title:`Prepare for ${name}`,detail:`Follow-up is due in ${days} day${days===1?'':'s'}.`,reason:'A quick review now makes the conversation more useful.',route:'contacts',kind:'contact',id:contact.id});
    }

    const deadlines=[['inspection_date','Inspection'],['appraisal_date','Appraisal'],['financing_deadline','Financing deadline'],['final_walkthrough_date','Final walk-through'],['closing_date','Closing']];
    for(const transaction of transactions){
      if(['cancelled','closed'].includes(String(transaction.status||'').toLowerCase()))continue;
      for(const [field,label] of deadlines){
        const due=atNoon(transaction[field]);if(!due)continue;
        const days=daysBetween(today,due);if(days<0||days>14)continue;
        add({score:days<=3?96-days:74-days,title:`${label}: ${transaction.property||'Transaction'}`,detail:days===0?'Scheduled for today.':`Scheduled in ${days} day${days===1?'':'s'}.`,reason:days<=3?'This deadline is close and should be confirmed.':'This upcoming milestone may require preparation.',route:'transactions',kind:'transaction',id:transaction.id});
      }
    }

    for(const listing of listings){
      if(!['active','coming soon'].includes(String(listing.status||'').toLowerCase()))continue;
      const listed=atNoon(listing.listing_date||listing.listed_at||listing.created_at),age=listed?daysBetween(listed,today):null,showings=Number(listing.showings||0),offers=Number(listing.offers||0);
      if(age!==null&&age>=7&&showings===0)add({score:58+Math.min(age,20)/10,title:`Review ${listing.address}`,detail:`Active for ${age} days with no showings recorded.`,reason:'This may be a signal to review presentation, exposure, price, or showing feedback.',route:'listings',kind:'listing',id:listing.id});
      else if(age!==null&&age>=21&&offers===0)add({score:54,title:`Check strategy for ${listing.address}`,detail:`Active for ${age} days with no offers recorded.`,reason:'A longer market period without offers deserves a strategy check.',route:'listings',kind:'listing',id:listing.id});
    }

    const activityByContact=new Map();
    for(const activity of activities){const id=Number(activity.contact_id),key=dateKey(activity.occurred_at);if(id&&key&&(!activityByContact.get(id)||key>activityByContact.get(id)))activityByContact.set(id,key)}
    for(const opportunity of opportunities){
      if(!isOpen(opportunity.status)||String(opportunity.stage||'').toLowerCase().includes('closed'))continue;
      const contact=contactById.get(Number(opportunity.contact_id));if(!contact||contact.next_follow_up)continue;
      const last=atNoon(contact.last_contact||activityByContact.get(Number(contact.id))),days=last?daysBetween(last,today):null;
      if(days===null||days>=14)add({score:48+(days===null?5:Math.min(days,30)/10),title:`Reconnect with ${nameOf(contact)}`,detail:days===null?'No recent contact is recorded.':`Last contact was ${days} days ago.`,reason:'This active opportunity has no next follow-up scheduled.',route:'contacts',kind:'contact',id:contact.id});
    }

    items.sort((a,b)=>b.score-a.score||a.title.localeCompare(b.title));
    const unique=[],seen=new Set();for(const item of items){const key=`${item.kind}:${item.id}:${item.title}`;if(seen.has(key))continue;seen.add(key);unique.push(item);if(unique.length===7)break}
    const urgent=unique.filter(item=>item.score>=90).length;
    return {date:todayKey,urgent,total:unique.length,items:unique,headline:urgent?`${urgent} item${urgent===1?'':'s'} need immediate attention.`:unique.length?`${unique.length} useful next step${unique.length===1?'':'s'} found.`:'Your CRM does not show any urgent work right now.'};
  }

  function contactStrategy(data={},contactId,nowValue=new Date()){
    const contact=(data.contacts||[]).find(item=>Number(item.id)===Number(contactId));if(!contact)return null;
    const now=new Date(nowValue),activities=(data.activities||[]).filter(item=>Number(item.contact_id)===Number(contact.id)).sort((a,b)=>String(b.occurred_at||b.created_at||'').localeCompare(String(a.occurred_at||a.created_at||''))),tasks=(data.tasks||[]).filter(item=>Number(item.contact_id)===Number(contact.id)&&isOpen(item.status)),opportunities=(data.opportunities||[]).filter(item=>Number(item.contact_id)===Number(contact.id)&&isOpen(item.status)),roles=Array.isArray(contact.roles)?contact.roles:[],timeline=contact.buyer_timeline||contact.seller_timeline||'',lastValue=contact.last_contact||activities[0]?.occurred_at||contact.created_at,last=lastValue?new Date(lastValue):null,daysSince=last&&!Number.isNaN(last.getTime())?Math.max(0,Math.floor((now-last)/DAY)):null,name=nameOf(contact),signals=[];
    if(/hot/i.test(timeline))signals.push('The contact is marked hot and ready.');
    else if(timeline)signals.push(`The recorded timeline is ${timeline}.`);
    if(daysSince===null)signals.push('No completed communication is recorded.');
    else signals.push(`Last recorded contact was ${daysSince} day${daysSince===1?'':'s'} ago.`);
    if(contact.next_follow_up)signals.push(`A follow-up is scheduled for ${dateKey(contact.next_follow_up)}.`);else signals.push('No next follow-up is scheduled.');
    if(opportunities.length)signals.push(`${opportunities.length} active ${opportunities.map(item=>item.type).join(' and ')} opportunity${opportunities.length===1?' is':'ies are'} open.`);
    const urgent=/hot/i.test(timeline)||daysSince===null||daysSince>=14||contact.next_follow_up&&dateKey(contact.next_follow_up)<=dateKey(now.toISOString()),title=roles.some(role=>String(role).toLowerCase()==='seller')?'Discuss timing and next steps':roles.some(role=>String(role).toLowerCase()==='buyer')?'Confirm search priorities and next steps':'Personal follow-up',due=new Date(now);due.setDate(due.getDate()+(urgent?0:2));due.setHours(9,0,0,0);
    return {contact,name,signals,openTasks:tasks.length,recommendation:title,reason:urgent?'This relationship has a time-sensitive or missing follow-up signal.':'A proactive touch keeps the relationship moving before it becomes overdue.',task:{title,contact_id:contact.id,due_at:`${due.getFullYear()}-${String(due.getMonth()+1).padStart(2,'0')}-${String(due.getDate()).padStart(2,'0')}T09:00`,priority:urgent?'High':'Medium',notes:`Assistant recommendation for ${name}: ${signals.join(' ')}`}};
  }

  function buildBusinessCoach(data={},nowValue=new Date()){
    const contacts=data.contacts||[],opportunities=(data.opportunities||[]).filter(item=>isOpen(item.status)),listings=(data.listings||[]).filter(item=>['active','coming soon'].includes(String(item.status||'').toLowerCase())),transactions=(data.transactions||[]).filter(item=>!['closed','cancelled'].includes(String(item.status||'').toLowerCase())),issues=[];
    const activeIds=new Set(opportunities.map(item=>Number(item.contact_id))),withoutFollowUp=contacts.filter(item=>activeIds.has(Number(item.id))&&!item.next_follow_up),missingContact=contacts.filter(item=>activeIds.has(Number(item.id))&&(!item.phone||!item.email)),staleListings=listings.filter(item=>Number(item.showings||0)===0||Number(item.offers||0)===0),incompleteDeals=transactions.filter(item=>!item.closing_date||!item.inspection_date||(!item.buyer_id&&!item.seller_id&&!item.co_seller_id));
    if(withoutFollowUp.length)issues.push({title:`${withoutFollowUp.length} active contact${withoutFollowUp.length===1?' has':'s have'} no next follow-up`,detail:'Add a specific date so these opportunities stay visible on the calendar.',route:'contacts',kind:'contacts'});
    if(missingContact.length)issues.push({title:`${missingContact.length} active contact${missingContact.length===1?' is':'s are'} missing phone or email`,detail:'Complete the contact record before the next outreach.',route:'contacts',kind:'contacts'});
    if(staleListings.length)issues.push({title:`${staleListings.length} listing${staleListings.length===1?' needs':'s need'} an activity review`,detail:'Review recorded showings, offers, feedback, pricing, and marketing follow-up.',route:'listings',kind:'listings'});
    if(incompleteDeals.length)issues.push({title:`${incompleteDeals.length} transaction${incompleteDeals.length===1?' has':'s have'} missing risk-control information`,detail:'Confirm parties and critical dates before the next deadline.',route:'transactions',kind:'transactions'});
    return {issues,headline:issues.length?`${issues.length} business gap${issues.length===1?'':'s'} are worth fixing.`:'Your core CRM records look organized right now.'};
  }

  function buildDealRisks(data={},nowValue=new Date()){
    const now=new Date(nowValue),items=[];for(const transaction of data.transactions||[]){if(['closed','cancelled'].includes(String(transaction.status||'').toLowerCase()))continue;const missing=[];if(!transaction.buyer_id)missing.push('buyer');if(!transaction.seller_id&&!transaction.co_seller_id)missing.push('seller');if(!transaction.inspection_date)missing.push('inspection date');if(!transaction.closing_date)missing.push('closing date');const close=transaction.closing_date?new Date(transaction.closing_date):null,days=close&&!Number.isNaN(close.getTime())?Math.ceil((close-now)/DAY):null;if(missing.length||days!==null&&days<=7)items.push({id:transaction.id,title:transaction.property||'Transaction',detail:[missing.length?`Missing ${missing.join(', ')}`:'',days!==null?days<0?`Closing is ${Math.abs(days)} days overdue`:`Closing is in ${days} day${days===1?'':'s'}`:''].filter(Boolean).join(' · '),reason:missing.length?'Missing parties or dates can hide responsibilities and deadlines.':'The closing is close enough to confirm every remaining milestone.'})}return {items,headline:items.length?`${items.length} transaction${items.length===1?' needs':'s need'} attention.`:'No current transaction risks were found.'};
  }

  root.CrmAssistantReasoning={buildAssistantInsights,contactStrategy,buildBusinessCoach,buildDealRisks};
})(typeof globalThis!=='undefined'?globalThis:this);
