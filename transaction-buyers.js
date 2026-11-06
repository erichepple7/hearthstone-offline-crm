// Transaction party improvements: complete buyer choices, first-name sorting, and co-buyers.
const openFormBeforeTransactionBuyerEnhancements=openForm;
openForm=async(table,defaults={},editId=null)=>{
  if(table==='transactions'){
    await api('/contacts/reconcile-pipelines',{method:'POST',body:'{}'});
    await load('contacts','opportunities');
  }
  return openFormBeforeTransactionBuyerEnhancements(table,defaults,editId)
};

const apiBeforeTransactionBuyerEnhancements=api;
api=async(path,options={})=>{
  const method=String(options.method||'GET').toUpperCase();
  if(!/^\/transactions(?:\/\d+)?$/.test(String(path))||!['POST','PUT'].includes(method))return apiBeforeTransactionBuyerEnhancements(path,options);
  const payload=JSON.parse(options.body||'{}');
  for(const key of ['buyer_id','co_buyer_id','seller_id','co_seller_id','listing_id'])payload[key]=payload[key]?Number(payload[key]):null;
  return apiBeforeTransactionBuyerEnhancements(path,{...options,body:JSON.stringify(payload)})
};

const showTransactionRecordBeforeCoBuyer=showTransactionRecord;
showTransactionRecord=async id=>{
  await showTransactionRecordBeforeCoBuyer(id);
  const transaction=(state.data.transactions||[]).find(item=>Number(item.id)===Number(id));
  if(!transaction?.co_buyer_name)return;
  const buyerLabel=[...document.querySelectorAll('.transaction-profile dt')].find(item=>item.textContent.trim()==='BUYER');
  const buyerValue=buyerLabel?.nextElementSibling;
  if(buyerValue&&!document.querySelector('.transaction-co-buyer'))buyerValue.insertAdjacentHTML('afterend',`<dt class="transaction-co-buyer">CO-BUYER</dt><dd class="transaction-co-buyer">${esc(transaction.co_buyer_name)}</dd>`)
};
