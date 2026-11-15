const SUPABASE_URL = "https://idaeaonahwlteumtvmpd.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_8snKV74CI7VPPeRZG4efAQ__MEh1sbZ";
const STORAGE_BUCKET = "payment-attachments";
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
const state = {vendors:[],clients:[],invoices:[],payments:[],accountTargets:[],defaultCurrency:"USD"};
let currentUser = null;
let activeModalType = null;
let activeRecordId = null;
let toastTimer = null;
let loadingCloud = false;

function blankState(){return {vendors:[],clients:[],invoices:[],payments:[],accountTargets:[],defaultCurrency:"USD"}}
function saveState(){renderAll()}
function uid(){return crypto.randomUUID()}
function esc(v=""){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function money(amount,currency="USD"){const n=Number(amount||0);return (currency==="PKR"?"₨":"$")+n.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}
function currencyTotals(items,amountFn){const totals={USD:0,PKR:0};items.forEach(x=>{const c=x.currency==="PKR"?"PKR":"USD";totals[c]+=Number(amountFn(x)||0)});return `${money(totals.USD,"USD")} <span class="muted">·</span> ${money(totals.PKR,"PKR")}`}
function initials(name=""){return name.trim().split(/\s+/).slice(0,2).map(x=>x[0]||"").join("").toUpperCase()||"?"}
function todayISO(){return new Date().toISOString().slice(0,10)}
function prettyDate(d){if(!d)return "—";return new Date(d+"T00:00:00").toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"})}
function getParty(id){return [...state.vendors,...state.clients].find(p=>p.id===id)}
function roleFor(p){if(state.vendors.some(x=>x.id===p?.id))return "vendor";if(state.clients.some(x=>x.id===p?.id))return "client";return ""}
function invoicePaid(inv){return state.payments.filter(p=>p.invoiceId===inv.id).reduce((s,p)=>s+Number(p.amount),0)}
function partyPayments(partyId,currency,kind){return state.payments.filter(p=>p.partyId===partyId&&p.currency===currency&&(!kind||p.paymentType===kind)).reduce((sum,p)=>sum+Number(p.amount||0),0)}
function accountTarget(partyId,currency){return state.accountTargets.find(x=>x.partyId===partyId&&x.currency===currency)}
function accountBalance(partyId,currency,kind){const target=accountTarget(partyId,currency);if(!target)return null;return Number(target.totalAmount||0)-partyPayments(partyId,currency,kind==="client"?"received":"sent")}
function accountOutstanding(kind,currency){const parties=kind==="client"?state.clients:state.vendors;return parties.reduce((sum,p)=>{const balance=accountBalance(p.id,currency,kind);if(balance!==null)return sum+Math.max(0,balance);const direction=kind==="client"?"receivable":"payable";return sum+state.invoices.filter(i=>i.partyId===p.id&&i.currency===currency&&i.direction===direction).reduce((s,i)=>s+Math.max(0,Number(i.amount)-invoicePaid(i)),0)},0)}
async function savePartyTargets(partyId,v){for(const currency of ["USD","PKR"]){const amount=Number((currency==="USD"?v.accountTotalUsd:v.accountTotalPkr)||0);const exists=accountTarget(partyId,currency);if(amount>0){const {error}=await db.from("party_account_targets").upsert({user_id:currentUser.id,party_id:partyId,currency,total_amount:amount},{onConflict:"user_id,party_id,currency"});if(error)throw error}else if(exists){const {error}=await db.from("party_account_targets").delete().eq("user_id",currentUser.id).eq("party_id",partyId).eq("currency",currency);if(error)throw error}}}
function invoiceStatus(inv){const paid=invoicePaid(inv);if(paid>=Number(inv.amount))return "Paid";if(paid>0)return "Partially Paid";if(inv.dueDate&&inv.dueDate<todayISO())return "Overdue";return "Unpaid"}
function statusClass(s){return s==="Paid"||s==="Received"?"status-paid":s==="Partially Paid"?"status-partial":s==="Overdue"||s==="Unpaid"?"status-unpaid":"status-pending"}
function showToast(msg){const el=document.getElementById("toast");el.textContent=msg;el.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove("show"),2600)}
function go(page){document.querySelectorAll(".page-view").forEach(x=>x.classList.toggle("active",x.id==="page-"+page));document.querySelectorAll(".nav-item[data-page]").forEach(x=>x.classList.toggle("active",x.dataset.page===page));document.getElementById("breadcrumbCurrent").textContent=page[0].toUpperCase()+page.slice(1);document.getElementById("sidebar").classList.remove("open");renderAll()}
function field(label,name,type="text",opts={}){const full=opts.full?" full":"";let input="";if(type==="select"){input=`<select name="${name}" ${opts.required?"required":""}>${opts.options.map(o=>`<option value="${esc(o.value)}">${esc(o.label)}</option>`).join("")}</select>`}else if(type==="textarea"){input=`<textarea name="${name}" placeholder="${esc(opts.placeholder||"")}"></textarea>`}else{input=`<input name="${name}" type="${type}" ${opts.required?"required":""} ${opts.step?`step="${opts.step}"`:""} ${opts.min!==undefined?`min="${opts.min}"`:""} placeholder="${esc(opts.placeholder||"")}" ${opts.accept?`accept="${opts.accept}"`:""} ${opts.value!==undefined?`value="${esc(opts.value)}"`:""}>`}return `<div class="form-field${full}"><label>${label}${opts.required?' <span style="color:#c44747">*</span>':""}</label>${input}</div>`}
function openModal(type,extra={}){activeModalType=type;activeRecordId=extra.record?.id||null;const body=document.getElementById("modalBody"),title=document.getElementById("modalTitle"),eyebrow=document.getElementById("modalEyebrow");let fields="";
 const people=[...state.vendors.map(p=>({...p,kind:"Vendor"})),...state.clients.map(p=>({...p,kind:"Client"}))];
 if(type==="vendor"||type==="client"){title.textContent=extra.record?`Edit ${type}`:(type==="vendor"?"Add vendor":"Add client");eyebrow.textContent="CONTACT PROFILE";fields=field("Name","name","text",{required:true,full:true,placeholder:"Enter contact name"})+field("Company name","companyName","text",{placeholder:"Optional"})+field("Email","email","email",{placeholder:"name@example.com"})+field("Phone / WhatsApp","phone","text",{placeholder:"Optional"})+field("Total account amount (USD)","accountTotalUsd","number",{step:"0.01",min:0,placeholder:"0.00"})+field("Total account amount (PKR)","accountTotalPkr","number",{step:"0.01",min:0,placeholder:"0.00"})+`<div class="form-hint full">Enter the overall amount due for this account. Payments will reduce the balance automatically. Leave zero if not applicable.</div>`+field("Notes","notes","textarea",{full:true,placeholder:"Add any useful details"})}
 if(type==="invoice"){title.textContent=extra.record?"Edit invoice":"Add invoice";eyebrow.textContent="INVOICE RECORD";const direction=extra.record?.direction||extra.direction||"payable";const opts=people.filter(p=>direction==="payable"?p.kind==="Vendor":p.kind==="Client").map(p=>({value:p.id,label:p.name}));fields=field("Invoice type","direction","select",{options:[{value:"payable",label:"Vendor invoice (you pay)"},{value:"receivable",label:"Client invoice (you receive)"}]})+field("Contact","partyId","select",{required:true,options:opts.length?opts:[{value:"",label:"Add a vendor or client first"}]})+field("Invoice number","invoiceNumber","text",{placeholder:"INV-1001"})+field("Invoice URL","invoiceUrl","url",{full:true,placeholder:"Paste invoice link"})+field("Amount","amount","number",{required:true,step:"0.01",min:0.01})+field("Currency","currency","select",{options:[{value:"USD",label:"USD ($)"},{value:"PKR",label:"PKR (₨)"}]})+field("Invoice date","invoiceDate","date",{value:todayISO()})+field("Due date","dueDate","date")+field("Notes","notes","textarea",{full:true})}
 if(type==="payment"){title.textContent=extra.record?"Edit transaction":"Add transaction";eyebrow.textContent="PAYMENT RECORD";fields=field("Transaction type","paymentType","select",{options:[{value:"received",label:"Money received"},{value:"sent",label:"Money sent"}]})+field("Contact","partyId","select",{required:true,options:people.map(p=>({value:p.id,label:`${p.name} (${p.kind})`})) .length?people.map(p=>({value:p.id,label:`${p.name} (${p.kind})`})):[{value:"",label:"Add a vendor or client first"}]})+field("Related invoice","invoiceId","select",{options:[{value:"",label:"Not linked to an invoice"},...state.invoices.map(i=>({value:i.id,label:`${i.invoiceNumber||"Invoice"} · ${getParty(i.partyId)?.name||"Contact"}`}))]})+field("Amount","amount","number",{required:true,step:"0.01",min:0.01})+field("Currency","currency","select",{options:[{value:"USD",label:"USD ($)"},{value:"PKR",label:"PKR (₨)"}]})+field("Payment date","transactionDate","date",{value:todayISO()})+field("Payment method","method","select",{options:["PayPal","JazzCash","EasyPaisa","Bank Transfer","Crypto","Cash","Other"].map(x=>({value:x,label:x}))})+field("Transaction / reference ID","reference","text",{placeholder:"Optional"})+field("Receipt screenshot (optional)","receipt","file",{full:true,accept:"image/png,image/jpeg,application/pdf"})+field("Notes","notes","textarea",{full:true,placeholder:"Add payment details"})}
 body.innerHTML=fields;
 const rec=extra.record;
 if(rec){Object.entries(rec).forEach(([key,value])=>{const el=body.querySelector(`[name="${key}"]`);if(el&&el.type!=="file")el.value=value??"";});if(type==="vendor"||type==="client"){body.querySelector(`[name="accountTotalUsd"]`).value=accountTarget(rec.id,"USD")?.totalAmount||"";body.querySelector(`[name="accountTotalPkr"]`).value=accountTarget(rec.id,"PKR")?.totalAmount||"";}}
 document.querySelector('#recordForm [type="submit"]').textContent=rec?"Save changes":"Save record";
 document.getElementById("modalBackdrop").classList.add("open");
 const dir=body.querySelector('[name="direction"]');if(dir){dir.addEventListener("change",()=>{const p=body.querySelector('[name="partyId"]');const list=(dir.value==="payable"?state.vendors:state.clients);p.innerHTML=list.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join("")||'<option value="">Add a contact first</option>'})}
 const payType=body.querySelector('[name="paymentType"]');if(payType){payType.addEventListener("change",()=>{const p=body.querySelector('[name="partyId"]');const list=payType.value==="sent"?state.vendors:state.clients;p.innerHTML=list.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join("")||'<option value="">Add a contact first</option>'})}
}
function closeModal(){document.getElementById("modalBackdrop").classList.remove("open");document.getElementById("recordForm").reset();activeModalType=null;activeRecordId=null;document.querySelector('#recordForm [type="submit"]').textContent="Save record"}
async function handleSubmit(e){
 e.preventDefault();
 if(!currentUser){showToast("Please sign in first.");return}
 const form=e.currentTarget,fd=new FormData(form),v=Object.fromEntries(fd.entries()),isEditing=!!activeRecordId;
 const submit=form.querySelector('[type="submit"]');submit.disabled=true;submit.textContent="Saving…";
 try{
  if(activeModalType==="vendor"||activeModalType==="client"){
   const role=activeModalType;
   const partyPayload={name:v.name.trim(),company:v.companyName||null,email:v.email||null,phone:v.phone||null,notes:v.notes||null};
   let partyId=activeRecordId;
   if(activeRecordId){const {error}=await db.from("parties").update(partyPayload).eq("id",activeRecordId).eq("user_id",currentUser.id);if(error)throw error;}
   else{
    const {data:party,error}=await db.from("parties").insert({user_id:currentUser.id,...partyPayload}).select().single();
    if(error)throw error;
    partyId=party.id;
    const {error:roleError}=await db.from("party_roles").insert({user_id:currentUser.id,party_id:party.id,role});
    if(roleError){await db.from("parties").delete().eq("id",party.id);throw roleError}
   }
   await savePartyTargets(partyId,v);
   await loadCloudData();closeModal();showToast(isEditing?"Contact and account updated.":"Contact and account saved to cloud.");return;
  }
  if(activeModalType==="invoice"){
   if(!v.partyId){showToast("Please add a contact first.");return}
   const invoiceNumber=v.invoiceNumber.trim()||`INV-${Date.now()}`;
   if(activeRecordId){
    const linkedPayments=state.payments.filter(p=>p.invoiceId===activeRecordId);
    const allocatedTotal=linkedPayments.reduce((sum,p)=>sum+Number(p.amount),0);
    if(linkedPayments.length&&(v.partyId!==state.invoices.find(i=>i.id===activeRecordId)?.partyId||v.direction!==state.invoices.find(i=>i.id===activeRecordId)?.direction||v.currency!==state.invoices.find(i=>i.id===activeRecordId)?.currency))throw new Error("This invoice has linked payments. To protect transaction history, contact, invoice type and currency cannot be changed while payments are linked.");
    if(Number(v.amount)<allocatedTotal-0.0001)throw new Error(`Invoice amount cannot be lower than its allocated payments (${money(allocatedTotal,v.currency)}).`);
   }
   const invoicePayload={party_id:v.partyId,invoice_number:invoiceNumber,invoice_type:v.direction,amount:Number(v.amount),currency:v.currency,invoice_date:v.invoiceDate||todayISO(),due_date:v.dueDate||null,description:v.notes||null,invoice_url:v.invoiceUrl||null};
   const result=activeRecordId?await db.from("invoices").update(invoicePayload).eq("id",activeRecordId).eq("user_id",currentUser.id):await db.from("invoices").insert({user_id:currentUser.id,...invoicePayload});
   if(result.error)throw result.error;
   await loadCloudData();closeModal();showToast(isEditing?"Invoice updated.":"Invoice saved to cloud.");return;
  }
  if(activeModalType==="payment"){
   if(!v.partyId){showToast("Please add a contact first.");return}
   const file=form.querySelector('[name="receipt"]').files[0];
   if(file&&file.size>5*1024*1024)throw new Error("File must be 5 MB or smaller.");
   const linkedInvoice=state.invoices.find(i=>i.id===v.invoiceId);
   if(linkedInvoice){
    if(linkedInvoice.partyId!==v.partyId)throw new Error("The selected invoice belongs to a different contact.");
    if(linkedInvoice.currency!==v.currency)throw new Error("Payment currency must match the invoice currency.");
    if((linkedInvoice.direction==="receivable"?"received":"sent")!==v.paymentType)throw new Error("Payment type does not match the invoice type.");
    const alreadyAllocated=linkedInvoice?state.payments.filter(p=>p.id!==activeRecordId&&p.invoiceId===linkedInvoice.id).reduce((sum,p)=>sum+Number(p.amount),0):0;
    const remaining=linkedInvoice?Math.max(0,Number(linkedInvoice.amount)-alreadyAllocated):0;
    if(linkedInvoice&&Number(v.amount)>remaining+0.0001)throw new Error(`Amount exceeds invoice remaining balance (${money(remaining,linkedInvoice.currency)}).`);
   }
   const paymentPayload={party_id:v.partyId,payment_type:v.paymentType,amount:Number(v.amount),currency:v.currency,payment_date:v.transactionDate||todayISO(),payment_method:v.method||null,reference_number:v.reference||null,notes:v.notes||null};
   let paymentId=activeRecordId;
   if(activeRecordId){const {error}=await db.from("payments").update(paymentPayload).eq("id",activeRecordId).eq("user_id",currentUser.id);if(error)throw error;const {error:delAllocError}=await db.from("payment_allocations").delete().eq("payment_id",activeRecordId).eq("user_id",currentUser.id);if(delAllocError)throw delAllocError;}
   else{const {data:payment,error}=await db.from("payments").insert({user_id:currentUser.id,...paymentPayload}).select().single();if(error)throw error;paymentId=payment.id;}
   if(linkedInvoice){const {error:allocationError}=await db.from("payment_allocations").insert({user_id:currentUser.id,payment_id:paymentId,invoice_id:linkedInvoice.id,allocated_amount:Number(v.amount)});if(allocationError)throw allocationError;}
   if(file){
    const safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,"_");
    const filePath=`${currentUser.id}/${paymentId}/${Date.now()}_${safeName}`;
    const {error:uploadError}=await db.storage.from(STORAGE_BUCKET).upload(filePath,file,{upsert:false,contentType:file.type||undefined});
    if(uploadError){if(!isEditing)await db.from("payments").delete().eq("id",paymentId);throw new Error(`Receipt upload failed: ${uploadError.message}`)}
    const {error:attachmentError}=await db.from("payment_attachments").insert({user_id:currentUser.id,payment_id:paymentId,file_name:file.name,file_path:filePath,file_type:file.type||null});
    if(attachmentError){await db.storage.from(STORAGE_BUCKET).remove([filePath]);if(!isEditing)await db.from("payments").delete().eq("id",paymentId);throw new Error(`Receipt record could not be saved: ${attachmentError.message}`)}
   }
   await loadCloudData();closeModal();showToast(isEditing?"Transaction updated.":"Transaction saved to cloud.");return;
  }
 }catch(error){console.error(error);showToast(error.message||"Could not save record.")}
 finally{submit.disabled=false;submit.textContent="Save record"}
}
function fileToDataURL(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file)})}
function renderAll(){renderDashboard();renderEntities("vendor");renderEntities("client");renderInvoices();renderPayments();renderReports();document.getElementById("defaultCurrency").value=state.defaultCurrency||"USD"}
function renderDashboard(){const received=state.payments.filter(p=>p.paymentType==="received"),sent=state.payments.filter(p=>p.paymentType==="sent");document.getElementById("statReceived").innerHTML=currencyTotals(received,p=>p.amount);document.getElementById("statSent").innerHTML=currencyTotals(sent,p=>p.amount);document.getElementById("statReceivable").innerHTML=`${money(accountOutstanding("client","USD"),"USD")} <span class="muted">·</span> ${money(accountOutstanding("client","PKR"),"PKR")}`;document.getElementById("statPayable").innerHTML=`${money(accountOutstanding("vendor","USD"),"USD")} <span class="muted">·</span> ${money(accountOutstanding("vendor","PKR"),"PKR")}`;
 const recent=[...state.payments].sort((a,b)=>b.transactionDate.localeCompare(a.transactionDate)).slice(0,5);document.getElementById("recentTransactions").innerHTML=recent.length?recent.map(paymentRow).join(""):'<tr><td colspan="6"><div class="empty-state">No transactions yet. Add your first payment.</div></td></tr>';
 const outstanding=state.invoices.filter(i=>invoiceStatus(i)!=="Paid").slice(0,5);document.getElementById("outstandingList").innerHTML=outstanding.length?outstanding.map(i=>`<div class="outstanding-item"><div><strong>${esc(getParty(i.partyId)?.name||"Unknown contact")}</strong><span>${esc(i.invoiceNumber||"Invoice")} · ${invoiceStatus(i)}</span></div><div class="outstanding-amount">${money(Math.max(0,Number(i.amount)-invoicePaid(i)),i.currency)}<span>Due ${prettyDate(i.dueDate)}</span></div></div>`).join(""):'<div class="empty-state compact">No outstanding invoices yet.</div>';renderMonthlySummary();renderChart()}
function renderMonthlySummary(){const now=new Date(),month=now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0");["USD","PKR"].forEach(currency=>{const sum=(type)=>state.payments.filter(p=>p.currency===currency&&p.paymentType===type&&p.transactionDate?.startsWith(month)).reduce((total,p)=>total+Number(p.amount||0),0);const outstanding=(direction)=>accountOutstanding(direction==="receivable"?"client":"vendor",currency);const received=sum("received"),sent=sum("sent"),prefix=currency==="USD"?"monthUsd":"monthPkr",outPrefix=currency==="USD"?"outUsd":"outPkr";document.getElementById(prefix+"Received").textContent=money(received,currency);document.getElementById(prefix+"Sent").textContent=money(sent,currency);document.getElementById(prefix+"Net").textContent=money(received-sent,currency);document.getElementById(outPrefix+"Receivable").textContent=money(outstanding("receivable"),currency);document.getElementById(outPrefix+"Payable").textContent=money(outstanding("payable"),currency)})}
function paymentRow(p){const party=getParty(p.partyId);const received=p.paymentType==="received";return `<tr><td><div class="contact-cell"><div class="mini-avatar">${initials(party?.name||"?")}</div><div><strong>${esc(party?.name||"Deleted contact")}</strong><span>${esc(p.reference||"Payment")}</span></div></div></td><td>${received?"<span class='trend' style='color:#15966a'>Received</span>":"<span style='color:#4779c8;font-weight:700'>Sent</span>"}</td><td>${prettyDate(p.transactionDate)}</td><td>${esc(p.method)}</td><td class="amount-cell">${received?"+":"−"}${money(p.amount,p.currency)}</td><td><span class="status ${received?"status-received":"status-pending"}">${received?"Received":"Sent"}</span></td></tr>`}
function renderChart(){const months=Number(document.getElementById("chartRange")?.value||6),currency=document.getElementById("chartCurrency")?.value||"USD",now=new Date(),items=[];for(let i=months-1;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1),key=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");const total=t=>state.payments.filter(p=>p.currency===currency&&p.paymentType===t&&p.transactionDate?.startsWith(key)).reduce((s,p)=>s+Number(p.amount),0);items.push({label:d.toLocaleDateString("en-US",{month:"short"}),r:total("received"),s:total("sent")})}const max=Math.max(1,...items.flatMap(x=>[x.r,x.s]));document.getElementById("cashflowChart").innerHTML=items.map(x=>`<div class="chart-column"><div class="bar received" style="height:${Math.max(x.r?3:0,x.r/max*100)}%"></div><div class="bar sent" style="height:${Math.max(x.s?3:0,x.s/max*100)}%"></div><span class="chart-month">${x.label}</span></div>`).join("")}
function renderEntities(kind){const arr=kind==="vendor"?state.vendors:state.clients,search=(document.getElementById(kind+"Search")?.value||"").toLowerCase(),filtered=arr.filter(p=>(p.name+" "+p.companyName+" "+p.email).toLowerCase().includes(search));document.getElementById(kind+"Count").textContent=`${arr.length} ${kind}${arr.length===1?"":"s"}`;document.getElementById(kind+"Grid").innerHTML=filtered.length?filtered.map(p=>{const inv=state.invoices.filter(i=>i.partyId===p.id),partyPayments=state.payments.filter(x=>x.partyId===p.id),paidText=currencyTotals(partyPayments,x=>x.amount),paymentType=kind==="vendor"?"sent":"received",usdTarget=accountTarget(p.id,"USD"),pkrTarget=accountTarget(p.id,"PKR"),usdPaid=partyPayments.filter(x=>x.currency==="USD"&&x.paymentType===paymentType).reduce((s,x)=>s+Number(x.amount),0),pkrPaid=partyPayments.filter(x=>x.currency==="PKR"&&x.paymentType===paymentType).reduce((s,x)=>s+Number(x.amount),0),usdRemain=usdTarget?Number(usdTarget.totalAmount)-usdPaid:state.invoices.filter(i=>i.partyId===p.id&&i.currency==="USD"&&i.direction===(kind==="vendor"?"payable":"receivable")).reduce((s,i)=>s+Math.max(0,Number(i.amount)-invoicePaid(i)),0),pkrRemain=pkrTarget?Number(pkrTarget.totalAmount)-pkrPaid:state.invoices.filter(i=>i.partyId===p.id&&i.currency==="PKR"&&i.direction===(kind==="vendor"?"payable":"receivable")).reduce((s,i)=>s+Math.max(0,Number(i.amount)-invoicePaid(i)),0);return `<article class="entity-card"><div class="entity-top"><div class="entity-avatar">${initials(p.name)}</div><div><div class="entity-title">${esc(p.name)}</div><div class="entity-meta">${esc(p.companyName||p.email||"Contact profile")}</div></div></div><div class="entity-stats"><div><span>Invoices</span><strong>${inv.length}</strong></div><div><span>${kind==="vendor"?"Paid":"Received"}</span><strong style="font-size:10px">${paidText}</strong></div><div><span>Remaining</span><strong style="font-size:10px">${money(Math.max(0,usdRemain),"USD")}<br>${money(Math.max(0,pkrRemain),"PKR")}</strong></div></div><div class="account-mini-summary"><span>Account total: USD ${usdTarget?money(usdTarget.totalAmount,"USD"):"Not set"} · PKR ${pkrTarget?money(pkrTarget.totalAmount,"PKR"):"Not set"}</span></div><div class="entity-actions"><span class="muted" style="font-size:9px">${esc(p.phone||"No phone added")}</span><div class="entity-action-buttons"><button class="link-btn" data-person="${p.id}" data-kind="${kind}">View account</button><button class="link-btn" data-edit-party="${p.id}" data-kind="${kind}">Edit</button><button class="link-btn danger-link" data-delete-party="${p.id}" data-kind="${kind}">Delete</button></div></div></article>`}).join(""):`<div class="panel empty-state" style="grid-column:1/-1">${search?"No matching contacts.":`No ${kind}s added yet. Use the button above to add your first ${kind}.`}</div>`}
function renderInvoices(){const q=(document.getElementById("invoiceSearch")?.value||"").toLowerCase(),filter=document.getElementById("invoiceFilter")?.value||"all";let arr=state.invoices.filter(i=>{const p=getParty(i.partyId),s=invoiceStatus(i).toLowerCase();return ((i.invoiceNumber+" "+(p?.name||"")).toLowerCase().includes(q))&&(filter==="all"||(filter==="receivable"&&i.direction==="receivable")||(filter==="payable"&&i.direction==="payable")||(filter==="unpaid"&&s==="unpaid")||(filter==="partial"&&s==="partially paid")||(filter==="paid"&&s==="paid")||(filter==="overdue"&&s==="overdue"))});document.getElementById("invoiceRows").innerHTML=arr.length?arr.map(i=>{const p=getParty(i.partyId),remaining=Math.max(0,Number(i.amount)-invoicePaid(i)),status=invoiceStatus(i);return `<tr><td><strong>${esc(i.invoiceNumber||"Invoice")}</strong>${i.invoiceUrl?`<div><a class="receipt-link" href="${esc(i.invoiceUrl)}" target="_blank" rel="noopener">Open invoice ↗</a></div>`:""}</td><td>${esc(p?.name||"Unknown")}</td><td>${i.direction==="payable"?"Vendor payable":"Client receivable"}</td><td>${prettyDate(i.invoiceDate)}</td><td>${prettyDate(i.dueDate)}</td><td class="amount-cell">${money(i.amount,i.currency)}</td><td class="amount-cell">${money(remaining,i.currency)}</td><td><span class="status ${statusClass(status)}">${status}</span></td><td><button class="link-btn" data-edit-invoice="${i.id}">Edit</button> <button class="row-action" data-delete-invoice="${i.id}" title="Delete invoice">×</button></td></tr>`}).join(""):'<tr><td colspan="9"><div class="empty-state">No invoices found.</div></td></tr>'}
function renderPayments(){const q=(document.getElementById("transactionSearch")?.value||"").toLowerCase(),filter=document.getElementById("transactionFilter")?.value||"all",month=document.getElementById("transactionMonth")?.value||"",partyFilter=document.getElementById("transactionPartyFilter")?.value||"all";const arr=[...state.payments].filter(p=>{const n=getParty(p.partyId)?.name||"";return (n+" "+p.method+" "+p.reference).toLowerCase().includes(q)&&(filter==="all"||p.paymentType===filter)&&(!month||p.transactionDate?.startsWith(month))&&(partyFilter==="all"||p.partyId===partyFilter)}).sort((a,b)=>b.transactionDate.localeCompare(a.transactionDate));const totalFor=(type,currency)=>arr.filter(p=>p.paymentType===type&&p.currency===currency).reduce((s,p)=>s+Number(p.amount||0),0);document.getElementById("transactionFilteredSummary").innerHTML=`<div><span>Filtered results</span><strong>${arr.length} transactions</strong></div><div><span>USD received</span><strong>${money(totalFor("received","USD"),"USD")}</strong></div><div><span>USD sent</span><strong>${money(totalFor("sent","USD"),"USD")}</strong></div><div><span>PKR received</span><strong>${money(totalFor("received","PKR"),"PKR")}</strong></div><div><span>PKR sent</span><strong>${money(totalFor("sent","PKR"),"PKR")}</strong></div>`;document.getElementById("transactionRows").innerHTML=arr.length?arr.map(p=>`<tr><td><div class="contact-cell"><div class="mini-avatar">${initials(getParty(p.partyId)?.name||"?")}</div><div><strong>${esc(getParty(p.partyId)?.name||"Unknown")}</strong><span>${esc(p.notes||"Payment record")}</span></div></div></td><td>${p.paymentType==="received"?"<span style='color:#15966a;font-weight:700'>Received</span>":"<span style='color:#4779c8;font-weight:700'>Sent</span>"}</td><td>${prettyDate(p.transactionDate)}</td><td>${esc(p.method)}</td><td>${esc(p.reference||"—")}</td><td class="amount-cell">${money(p.amount,p.currency)}</td><td>${p.receiptData?`<a class="receipt-link" href="${esc(p.receiptData)}" target="_blank" rel="noopener">View file ↗</a>`:"<span class='muted'>—</span>"}</td><td><button class="link-btn" data-edit-payment="${p.id}">Edit</button> <button class="row-action" data-delete-payment="${p.id}" title="Delete transaction">×</button></td></tr>`).join(""):'<tr><td colspan="8"><div class="empty-state">No transactions found.</div></td></tr>'}
function renderReports(){document.getElementById("reportVendors").textContent=state.vendors.length;document.getElementById("reportClients").textContent=state.clients.length;document.getElementById("reportInvoices").textContent=state.invoices.length;document.getElementById("reportTransactions").textContent=state.payments.length;const methods={};state.payments.forEach(p=>methods[p.method]=(methods[p.method]||0)+1);const max=Math.max(1,...Object.values(methods));document.getElementById("methodReport").innerHTML=Object.keys(methods).length?Object.entries(methods).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<div class="method-line"><span>${esc(k)}</span><div class="method-track"><div class="method-fill" style="width:${v/max*100}%"></div></div><strong>${v}</strong></div>`).join(""):'<div class="empty-state compact">Add transactions to see payment method insights.</div>'}
async function deleteItem(type,id,partyKind=null){
 if(!confirm("Are you sure you want to delete this record? This action cannot be undone."))return;
 try{
  if(type==="party"){
   const party=getParty(id);if(!party)return;
   const linkedInvoices=state.invoices.filter(i=>i.partyId===id),linkedPayments=state.payments.filter(p=>p.partyId===id);
   if(linkedInvoices.length||linkedPayments.length)throw new Error(`Cannot delete ${party.name} because it has ${linkedInvoices.length} invoice(s) and ${linkedPayments.length} transaction(s). Delete or reassign those records first.`);
   const kind=partyKind||roleFor(party);const {error:roleError}=await db.from("party_roles").delete().eq("party_id",id).eq("role",kind).eq("user_id",currentUser.id);if(roleError)throw roleError;
   const {data:remainingRoles,error:rolesError}=await db.from("party_roles").select("id").eq("party_id",id).eq("user_id",currentUser.id);if(rolesError)throw rolesError;
   if(!remainingRoles?.length){const {error}=await db.from("parties").delete().eq("id",id).eq("user_id",currentUser.id);if(error)throw error;}
  }else if(type==="invoice"){
   const {error:allocError}=await db.from("payment_allocations").delete().eq("invoice_id",id).eq("user_id",currentUser.id);if(allocError)throw allocError;
   const {error}=await db.from("invoices").delete().eq("id",id).eq("user_id",currentUser.id);if(error)throw error;
  }else{
   const attachments=state.payments.find(p=>p.id===id)?.attachments||[];
   const {error:allocError}=await db.from("payment_allocations").delete().eq("payment_id",id).eq("user_id",currentUser.id);if(allocError)throw allocError;
   const {error:attachError}=await db.from("payment_attachments").delete().eq("payment_id",id).eq("user_id",currentUser.id);if(attachError)throw attachError;
   const {error}=await db.from("payments").delete().eq("id",id).eq("user_id",currentUser.id);if(error)throw error;
   for(const a of attachments){const {error:storageError}=await db.storage.from(STORAGE_BUCKET).remove([a.filePath]);if(storageError)console.warn("Could not remove receipt file:",storageError.message);}
  }
  await loadCloudData();showToast("Record deleted.");
 }catch(error){console.error(error);showToast(error.message||"Delete failed.")}
}

function downloadFile(name,content,type){const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;a.click();URL.revokeObjectURL(url)}
function exportCsv(){const rows=[["Date","Contact","Type","Amount","Currency","Method","Reference","Notes"],...state.payments.map(p=>[p.transactionDate,getParty(p.partyId)?.name||"",p.paymentType,p.amount,p.currency,p.method,p.reference||"",p.notes||""])];const csv=rows.map(r=>r.map(x=>`"${String(x??"").replace(/"/g,'""')}"`).join(",")).join("\n");downloadFile("linkify-transactions.csv",csv,"text/csv");showToast("CSV report exported.")}
function exportBackup(){downloadFile("linkify-backup.json",JSON.stringify(state,null,2),"application/json");showToast("JSON backup downloaded.")}
function openPersonActivity(id,kind){const p=getParty(id);if(!p)return;const invoices=state.invoices.filter(i=>i.partyId===id),payments=state.payments.filter(x=>x.partyId===id).sort((a,b)=>b.transactionDate.localeCompare(a.transactionDate)),paymentType=kind==="vendor"?"sent":"received";const balances=["USD","PKR"].map(c=>{const t=accountTarget(id,c),paid=partyPayments(id,c,paymentType),remaining=t?Number(t.totalAmount)-paid:null;const invoiceRemaining=state.invoices.filter(i=>i.partyId===id&&i.currency===c&&i.direction===(kind==="vendor"?"payable":"receivable")).reduce((s,i)=>s+Math.max(0,Number(i.amount)-invoicePaid(i)),0);return `${c}: Total ${t?money(t.totalAmount,c):"Invoice based"} | ${kind==="vendor"?"Paid":"Received"} ${money(paid,c)} | Remaining ${money(Math.max(0,remaining===null?invoiceRemaining:remaining),c)}${remaining!==null&&remaining<0?` (Credit ${money(Math.abs(remaining),c)})`:""}`});const history=payments.map(x=>`${x.paymentType.toUpperCase()} ${money(x.amount,x.currency)} · ${prettyDate(x.transactionDate)} · ${x.method||"No method"} · ${x.notes||""}`);alert(`${p.name} ACCOUNT\\n${p.email||""}\\n${p.phone||""}\\n\\n${balances.join("\\n")}\\n\\nINVOICES: ${invoices.length}\\n\\nTRANSACTION HISTORY\\n${history.join("\\n")||"No payments recorded yet."}`)}

async function loadCloudData(){
 if(!currentUser)return;
 loadingCloud=true;
 try{
  const [partiesRes,rolesRes,invoicesRes,paymentsRes,allocRes,attachmentsRes,targetsRes]=await Promise.all([
   db.from("parties").select("*").eq("user_id",currentUser.id),
   db.from("party_roles").select("*").eq("user_id",currentUser.id),
   db.from("invoices").select("*").eq("user_id",currentUser.id),
   db.from("payments").select("*").eq("user_id",currentUser.id).order("payment_date",{ascending:false}),
   db.from("payment_allocations").select("*").eq("user_id",currentUser.id),
   db.from("payment_attachments").select("*").eq("user_id",currentUser.id),
   db.from("party_account_targets").select("*").eq("user_id",currentUser.id)
  ]);
  for(const r of [partiesRes,rolesRes,invoicesRes,paymentsRes,allocRes,attachmentsRes,targetsRes])if(r.error)throw r.error;
  const parties=partiesRes.data||[],roles=rolesRes.data||[],roleMap=new Map();
  roles.forEach(r=>{if(!roleMap.has(r.party_id))roleMap.set(r.party_id,[]);roleMap.get(r.party_id).push(r.role)});
  const mappedParties=parties.map(p=>({...p,companyName:p.company||"",createdAt:p.created_at}));
  state.vendors=mappedParties.filter(p=>(roleMap.get(p.id)||[]).includes("vendor"));
  state.clients=mappedParties.filter(p=>(roleMap.get(p.id)||[]).includes("client"));
  state.invoices=(invoicesRes.data||[]).map(i=>({id:i.id,partyId:i.party_id,direction:i.invoice_type,invoiceNumber:i.invoice_number,invoiceUrl:i.invoice_url||"",amount:Number(i.amount),currency:i.currency,invoiceDate:i.invoice_date,dueDate:i.due_date||"",notes:i.description||"",createdAt:i.created_at}));
  state.accountTargets=(targetsRes.data||[]).map(t=>({id:t.id,partyId:t.party_id,currency:t.currency,totalAmount:Number(t.total_amount)}));
  const allocations=allocRes.data||[],attachments=attachmentsRes.data||[];
  state.payments=await Promise.all((paymentsRes.data||[]).map(async p=>{
   const mappedAttachments=await Promise.all(attachments.filter(a=>a.payment_id===p.id).map(async a=>{
    const {data,error}=await db.storage.from(STORAGE_BUCKET).createSignedUrl(a.file_path,3600);
    if(error)console.warn("Could not create receipt link:",error.message);
    return {id:a.id,fileName:a.file_name,filePath:a.file_path,fileType:a.file_type||"",url:data?.signedUrl||""};
   }));
   const allocation=allocations.find(a=>a.payment_id===p.id);
   return {id:p.id,partyId:p.party_id,paymentType:p.payment_type,invoiceId:allocation?.invoice_id||"",amount:Number(p.amount),currency:p.currency,transactionDate:p.payment_date,method:p.payment_method||"",reference:p.reference_number||"",notes:p.notes||"",receiptName:mappedAttachments[0]?.fileName||"",receiptData:mappedAttachments[0]?.url||"",attachments:mappedAttachments,createdAt:p.created_at};
  }));
  const partyFilter=document.getElementById("transactionPartyFilter");if(partyFilter){const selected=partyFilter.value||"all";partyFilter.innerHTML=`<option value="all">All contacts</option>${[...state.clients.map(x=>({...x,kind:"Client"})),...state.vendors.map(x=>({...x,kind:"Vendor"}))].sort((a,b)=>a.name.localeCompare(b.name)).map(x=>`<option value="${x.id}">${esc(x.name)} (${x.kind})</option>`).join("")}`;partyFilter.value=[...partyFilter.options].some(o=>o.value===selected)?selected:"all"}
  renderAll();
 }finally{loadingCloud=false}
}
function showAuthMessage(message,isError=true){const el=document.getElementById("authMessage");el.textContent=message;el.className=isError?"auth-message error":"auth-message success"}
function setAuthenticated(user){currentUser=user;document.getElementById("loginScreen").classList.add("hidden");document.querySelector(".app-shell").classList.add("ready");document.getElementById("signedInEmail").textContent=user.email||"Signed in"}
async function handleLogin(e){
 e.preventDefault();const btn=document.getElementById("loginButton"),email=document.getElementById("loginEmail").value.trim(),password=document.getElementById("loginPassword").value;
 btn.disabled=true;btn.textContent="Signing in…";showAuthMessage("Checking your account…",false);
 try{const {data,error}=await db.auth.signInWithPassword({email,password});if(error)throw error;setAuthenticated(data.user);await loadCloudData()}
 catch(error){console.error(error);showAuthMessage(error.message||"Sign in failed.")}
 finally{btn.disabled=false;btn.textContent="Sign in"}
}
async function handleLogout(){
 const {error}=await db.auth.signOut();if(error){showToast(error.message);return}
 currentUser=null;Object.assign(state,blankState());document.querySelector(".app-shell").classList.remove("ready");document.getElementById("loginScreen").classList.remove("hidden");document.getElementById("loginPassword").value="";showAuthMessage("You have signed out.",false);
}
async function initialiseApp(){
 document.getElementById("loginForm").addEventListener("submit",handleLogin);
 document.getElementById("signOutBtn").addEventListener("click",handleLogout);
 try{
  const {data,error}=await db.auth.getSession();if(error)throw error;
  if(data.session?.user){setAuthenticated(data.session.user);await loadCloudData()}
  else{document.querySelector(".app-shell").classList.remove("ready");document.getElementById("loginScreen").classList.remove("hidden")}
  db.auth.onAuthStateChange((_event,session)=>{if(!session){currentUser=null;document.querySelector(".app-shell").classList.remove("ready");document.getElementById("loginScreen").classList.remove("hidden")} });
 }catch(error){console.error(error);showAuthMessage(error.message||"Could not connect to Supabase.")}
}

document.querySelectorAll(".nav-item[data-page]").forEach(b=>b.addEventListener("click",()=>go(b.dataset.page)));
document.querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",()=>go(b.dataset.go)));
document.getElementById("mobileMenu").addEventListener("click",()=>document.getElementById("sidebar").classList.toggle("open"));
document.getElementById("addVendorBtn").addEventListener("click",()=>openModal("vendor"));document.getElementById("addClientBtn").addEventListener("click",()=>openModal("client"));document.getElementById("addInvoiceBtn").addEventListener("click",()=>openModal("invoice"));document.getElementById("addTransactionBtn").addEventListener("click",()=>openModal("payment"));document.getElementById("dashboardAddBtn").addEventListener("click",()=>openModal("payment"));document.getElementById("quickAddBtn").addEventListener("click",()=>openModal("payment"));
document.getElementById("closeModal").addEventListener("click",closeModal);document.getElementById("cancelModal").addEventListener("click",closeModal);document.getElementById("modalBackdrop").addEventListener("click",e=>{if(e.target.id==="modalBackdrop")closeModal()});document.getElementById("recordForm").addEventListener("submit",handleSubmit);
["vendor","client"].forEach(k=>document.getElementById(k+"Search").addEventListener("input",()=>renderEntities(k)));document.getElementById("invoiceSearch").addEventListener("input",renderInvoices);document.getElementById("invoiceFilter").addEventListener("change",renderInvoices);document.getElementById("transactionSearch").addEventListener("input",renderPayments);document.getElementById("transactionFilter").addEventListener("change",renderPayments);document.getElementById("transactionMonth").addEventListener("change",renderPayments);document.getElementById("transactionPartyFilter").addEventListener("change",renderPayments);document.getElementById("chartRange").addEventListener("change",renderChart);document.getElementById("chartCurrency").addEventListener("change",renderChart);
document.addEventListener("click",e=>{
 const person=e.target.closest("[data-person]");if(person)openPersonActivity(person.dataset.person,person.dataset.kind);
 const ep=e.target.closest("[data-edit-party]");if(ep){const rec=getParty(ep.dataset.editParty);if(rec)openModal(ep.dataset.kind,{record:{id:rec.id,name:rec.name,companyName:rec.companyName,email:rec.email,phone:rec.phone,notes:rec.notes}})}
 const dp=e.target.closest("[data-delete-party]");if(dp)deleteItem("party",dp.dataset.deleteParty,dp.dataset.kind);
 const ei=e.target.closest("[data-edit-invoice]");if(ei){const r=state.invoices.find(x=>x.id===ei.dataset.editInvoice);if(r)openModal("invoice",{record:{id:r.id,direction:r.direction,partyId:r.partyId,invoiceNumber:r.invoiceNumber,invoiceUrl:r.invoiceUrl,amount:r.amount,currency:r.currency,invoiceDate:r.invoiceDate,dueDate:r.dueDate,notes:r.notes}})}
 const epay=e.target.closest("[data-edit-payment]");if(epay){const r=state.payments.find(x=>x.id===epay.dataset.editPayment);if(r)openModal("payment",{record:{id:r.id,paymentType:r.paymentType,partyId:r.partyId,invoiceId:r.invoiceId,amount:r.amount,currency:r.currency,transactionDate:r.transactionDate,method:r.method,reference:r.reference,notes:r.notes}})}
 const di=e.target.closest("[data-delete-invoice]");if(di)deleteItem("invoice",di.dataset.deleteInvoice);
 const dpay=e.target.closest("[data-delete-payment]");if(dpay)deleteItem("payment",dpay.dataset.deletePayment);
});
document.getElementById("exportCsvBtn").addEventListener("click",exportCsv);document.getElementById("downloadBackupBtn").addEventListener("click",exportBackup);document.getElementById("clearDataBtn").addEventListener("click",handleLogout);document.getElementById("defaultCurrency").addEventListener("change",e=>{state.defaultCurrency=e.target.value;saveState();showToast("Preference saved.")});
document.getElementById("todayLabel").textContent=new Date().toLocaleDateString("en-US",{weekday:"short",day:"numeric",month:"short",year:"numeric"});
initialiseApp();
