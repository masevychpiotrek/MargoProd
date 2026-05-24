const AC=new(window.AudioContext||window.webkitAudioContext)();
function resumeAC(){if(AC.state==='suspended')AC.resume();}
document.addEventListener('click',resumeAC,{once:true});
document.addEventListener('keydown',resumeAC,{once:true});
document.addEventListener('touchstart',resumeAC,{once:true});
setTimeout(resumeAC,200);
setTimeout(resumeAC,500);
setTimeout(resumeAC,1000);

function mkNoise(dur){
  const b=AC.createBuffer(1,Math.floor(AC.sampleRate*dur),AC.sampleRate);
  const d=b.getChannelData(0);
  for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;
  return b;
}

let motorNode=null,motorGain=null,motorTickIv=null;
function startMotor(){
  if(motorNode)return;
  try{
    const o=AC.createOscillator(),g=AC.createGain(),lp=AC.createBiquadFilter();
    lp.type='lowpass';lp.frequency.value=180;
    o.type='sawtooth';o.frequency.value=42;
    o.connect(lp);lp.connect(g);g.connect(AC.destination);
    g.gain.setValueAtTime(0,AC.currentTime);
    g.gain.linearRampToValueAtTime(.022,AC.currentTime+.3);
    o.start();motorNode=o;motorGain=g;
  }catch(e){}
}
function stopMotor(){
  if(!motorNode)return;
  try{motorGain.gain.linearRampToValueAtTime(0,AC.currentTime+.25);motorNode.stop(AC.currentTime+.28);}catch(e){}
  motorNode=null;motorGain=null;
  if(motorTickIv){clearInterval(motorTickIv);motorTickIv=null;}
}

function sndSpark(){
  try{
    const s=AC.createBufferSource(),g=AC.createGain(),hp=AC.createBiquadFilter();
    hp.type='highpass';hp.frequency.value=5000;
    s.buffer=mkNoise(.04);s.connect(hp);hp.connect(g);g.connect(AC.destination);
    g.gain.setValueAtTime(.3,AC.currentTime);
    g.gain.exponentialRampToValueAtTime(.001,AC.currentTime+.05);
    s.start();
  }catch(e){}
}

function sndClunk(){
  try{
    const o=AC.createOscillator(),g=AC.createGain();
    o.type='sine';
    o.frequency.setValueAtTime(90,AC.currentTime);
    o.frequency.exponentialRampToValueAtTime(22,AC.currentTime+.2);
    g.gain.setValueAtTime(.55,AC.currentTime);
    g.gain.exponentialRampToValueAtTime(.001,AC.currentTime+.22);
    o.connect(g);g.connect(AC.destination);o.start();o.stop(AC.currentTime+.25);
    const o2=AC.createOscillator(),g2=AC.createGain();
    const bp=AC.createBiquadFilter();bp.type='bandpass';bp.frequency.value=1800;bp.Q.value=12;
    o2.type='sine';o2.frequency.value=1800;
    o2.connect(bp);bp.connect(g2);g2.connect(AC.destination);
    g2.gain.setValueAtTime(.12,AC.currentTime);
    g2.gain.exponentialRampToValueAtTime(.001,AC.currentTime+.18);
    o2.start();o2.stop(AC.currentTime+.2);
  }catch(e){}
}

function sndGrip(){
  try{
    const o=AC.createOscillator(),g=AC.createGain();
    o.type='sine';o.frequency.value=240;
    g.gain.setValueAtTime(.1,AC.currentTime);
    g.gain.exponentialRampToValueAtTime(.001,AC.currentTime+.06);
    o.connect(g);g.connect(AC.destination);o.start();o.stop(AC.currentTime+.07);
  }catch(e){}
}

function sndWhoosh(){
  try{
    const s=AC.createBufferSource(),g=AC.createGain(),lp=AC.createBiquadFilter();
    lp.type='lowpass';lp.frequency.value=600;
    s.buffer=mkNoise(.5);s.connect(lp);lp.connect(g);g.connect(AC.destination);
    g.gain.setValueAtTime(0,AC.currentTime);
    g.gain.linearRampToValueAtTime(.18,AC.currentTime+.12);
    g.gain.linearRampToValueAtTime(0,AC.currentTime+.5);
    s.start();
  }catch(e){}
}

function sndToolSwap(){
  try{
    [0,.1].forEach(t=>{
      const o=AC.createOscillator(),g=AC.createGain();
      o.type='sine';o.frequency.value=320;
      g.gain.setValueAtTime(.14,AC.currentTime+t);
      g.gain.exponentialRampToValueAtTime(.001,AC.currentTime+t+.07);
      o.connect(g);g.connect(AC.destination);
      o.start(AC.currentTime+t);o.stop(AC.currentTime+t+.09);
    });
  }catch(e){}
}

let paintHissNode=null,paintHissGain=null,paintHissIv=null;
function startPaintHiss(){
  if(paintHissNode)return;
  try{
    const s=AC.createBufferSource(),g=AC.createGain();
    const bp=AC.createBiquadFilter();bp.type='bandpass';bp.frequency.value=3000;bp.Q.value=.5;
    const lp=AC.createBiquadFilter();lp.type='lowpass';lp.frequency.value=5000;
    s.buffer=mkNoise(60);s.loop=true;
    s.connect(bp);bp.connect(lp);lp.connect(g);g.connect(AC.destination);
    g.gain.setValueAtTime(0,AC.currentTime);
    g.gain.linearRampToValueAtTime(.055,AC.currentTime+.3);
    s.start();paintHissNode=s;paintHissGain=g;
  }catch(e){}
}
function stopPaintHiss(){
  if(!paintHissNode)return;
  try{paintHissGain.gain.linearRampToValueAtTime(0,AC.currentTime+.3);paintHissNode.stop(AC.currentTime+.35);}catch(e){}
  paintHissNode=null;paintHissGain=null;
  if(paintHissIv){clearInterval(paintHissIv);paintHissIv=null;}
}

function sndFanfare(){
  try{
    const now=AC.currentTime;
    const bass=AC.createOscillator(),bg=AC.createGain();
    bass.type='sine';
    bass.frequency.setValueAtTime(58,now);
    bass.frequency.exponentialRampToValueAtTime(28,now+.45);
    bg.gain.setValueAtTime(.6,now);bg.gain.exponentialRampToValueAtTime(.001,now+.5);
    bass.connect(bg);bg.connect(AC.destination);bass.start(now);bass.stop(now+.55);
    [[220,0,.13],[330,.06,.1],[440,.12,.08]].forEach(([f,delay,vol])=>{
      const o=AC.createOscillator(),g=AC.createGain();
      const lp=AC.createBiquadFilter();lp.type='lowpass';lp.frequency.value=1100;
      o.type='sawtooth';o.frequency.value=f;
      o.connect(lp);lp.connect(g);g.connect(AC.destination);
      g.gain.setValueAtTime(0,now+delay);
      g.gain.linearRampToValueAtTime(vol,now+delay+.09);
      g.gain.linearRampToValueAtTime(vol*.55,now+delay+.65);
      g.gain.linearRampToValueAtTime(0,now+delay+1.3);
      o.start(now+delay);o.stop(now+delay+1.4);
    });
    const sw=AC.createOscillator(),sg=AC.createGain();
    const slp=AC.createBiquadFilter();slp.type='lowpass';slp.frequency.value=850;
    sw.type='triangle';
    sw.frequency.setValueAtTime(160,now+.28);
    sw.frequency.exponentialRampToValueAtTime(680,now+.92);
    sw.connect(slp);slp.connect(sg);sg.connect(AC.destination);
    sg.gain.setValueAtTime(0,now+.28);
    sg.gain.linearRampToValueAtTime(.14,now+.42);
    sg.gain.linearRampToValueAtTime(0,now+.96);
    sw.start(now+.28);sw.stop(now+1.0);
    const ping=AC.createOscillator(),pg=AC.createGain();
    const pbp=AC.createBiquadFilter();pbp.type='bandpass';pbp.frequency.value=2400;pbp.Q.value=18;
    ping.type='sine';ping.frequency.value=2400;
    ping.connect(pbp);pbp.connect(pg);pg.connect(AC.destination);
    pg.gain.setValueAtTime(.25,now+.2);
    pg.gain.exponentialRampToValueAtTime(.001,now+1.1);
    ping.start(now+.2);ping.stop(now+1.2);
    const chime=AC.createOscillator(),cg=AC.createGain();
    chime.type='sine';chime.frequency.value=1320;
    cg.gain.setValueAtTime(0,now+.88);
    cg.gain.linearRampToValueAtTime(.2,now+.93);
    cg.gain.exponentialRampToValueAtTime(.001,now+2.0);
    chime.connect(cg);cg.connect(AC.destination);
    chime.start(now+.88);chime.stop(now+2.1);
    const ns=AC.createBufferSource(),ng=AC.createGain();
    const nlp=AC.createBiquadFilter();nlp.type='lowpass';nlp.frequency.value=380;
    ns.buffer=mkNoise(.75);ns.connect(nlp);nlp.connect(ng);ng.connect(AC.destination);
    ng.gain.setValueAtTime(0,now);
    ng.gain.linearRampToValueAtTime(.07,now+.12);
    ng.gain.linearRampToValueAtTime(0,now+.75);
    ns.start(now);
  }catch(e){}
}

const bgC=document.getElementById('bg'),mc=document.getElementById('main');
const bc=bgC.getContext('2d'),ctx=mc.getContext('2d');
let W,H,CX,CY;
function resize(){
  W=bgC.width=mc.width=window.innerWidth;
  H=bgC.height=mc.height=window.innerHeight;
  CX=W/2;CY=H*.4;
}
resize();window.addEventListener('resize',resize);

const lerp=(a,b,t)=>a+(b-a)*t;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const ease=(t)=>t<.5?2*t*t:-1+(4-2*t)*t;
const rand=(a,b)=>a+Math.random()*(b-a);
const HR=()=>Math.min(W,H)*.145;
const BASE_Y=()=>H*.85;
const BASE_X=()=>CX;

function getHex(){
  const r=HR();
  return Array.from({length:6},(_,i)=>{
    const a=Math.PI/180*(60*i-90);
    return{x:CX+r*Math.cos(a),y:CY+r*Math.sin(a)};
  });
}

let bgParts=[],bgAlpha=0;
function initBG(){
  bgParts=[];
  for(let i=0;i<80;i++)bgParts.push(mkBGP(true));
}
function mkBGP(rnd=false){
  return{x:rand(0,W),y:rnd?rand(0,H):-5,vx:rand(-.12,.12),vy:rand(.08,.6),
    r:rand(.3,1.5),a:rand(.05,.28),col:Math.random()<.6?'#D4A825':'#7799bb'};
}
function drawBG(){
  bc.clearRect(0,0,W,H);
  const g=bc.createRadialGradient(CX,CY*.5,0,CX,CY,Math.max(W,H)*.85);
  g.addColorStop(0,'#0e1b28');g.addColorStop(1,'#080c10');
  bc.fillStyle=g;bc.fillRect(0,0,W,H);
  bc.save();bc.globalAlpha=.025;bc.strokeStyle='#D4A825';bc.lineWidth=.7;
  for(let x=0;x<W;x+=50){bc.beginPath();bc.moveTo(x,0);bc.lineTo(x,H);bc.stroke();}
  for(let y=0;y<H;y+=50){bc.beginPath();bc.moveTo(0,y);bc.lineTo(W,y);bc.stroke();}
  bc.restore();
  bgParts.forEach((p,i)=>{
    bc.save();bc.globalAlpha=p.a*bgAlpha;bc.fillStyle=p.col;
    bc.beginPath();bc.arc(p.x,p.y,p.r,0,Math.PI*2);bc.fill();bc.restore();
    p.x+=p.vx;p.y+=p.vy;if(p.y>H+5)bgParts[i]=mkBGP(false);
  });
  const v=bc.createRadialGradient(CX,CY,Math.min(W,H)*.18,CX,CY,Math.max(W,H)*.9);
  v.addColorStop(0,'transparent');v.addColorStop(1,'rgba(0,0,0,.7)');
  bc.fillStyle=v;bc.fillRect(0,0,W,H);
}

let parts=[];
function sparks(x,y,n=12,col='#F0C84A',pow=1){
  for(let i=0;i<n;i++){
    const a=rand(0,Math.PI*2),s=rand(2,5.5)*pow;
    parts.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s-rand(0,2.5),
      life:1,dec:rand(.022,.05),r:rand(1.5,3.2),col});
  }
}
function shockwave(x,y,col='#D4A825'){
  parts.push({type:'wave',x,y,r:4,maxR:HR()*.9,life:1,dec:.055,col});
  parts.push({type:'wave',x,y,r:4,maxR:HR()*.6,life:.5,dec:.08,col:'rgba(255,255,255,.7)'});
  sparks(x,y,42,'#F0C84A',2.2);sparks(x,y,20,'#ffffff',2.4);sparks(x,y,14,'#ff7700',1.4);
  sndClunk();
}
function paintSplash(x,y){
  parts.push({type:'wave',x,y,r:1,maxR:HR()*.28,life:.5,dec:.055,col:'#D4A825'});
  sparks(x,y,3,'#F0C84A',.9);
}
function drawParts(){
  parts=parts.filter(p=>p.life>0);
  for(const p of parts){
    ctx.save();
    if(p.type==='wave'){
      ctx.globalAlpha=p.life*.38;ctx.strokeStyle=p.col;ctx.lineWidth=2;
      ctx.shadowBlur=16;ctx.shadowColor=p.col;
      ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.stroke();
      p.r=lerp(p.r,p.maxR,.12);
    }else{
      ctx.globalAlpha=p.life;ctx.fillStyle=p.col;
      ctx.shadowBlur=6;ctx.shadowColor=p.col;
      ctx.beginPath();ctx.arc(p.x,p.y,p.r*p.life,0,Math.PI*2);ctx.fill();
      p.x+=p.vx;p.y+=p.vy;p.vy+=.1;p.vx*=.96;
    }
    p.life-=p.dec;ctx.restore();
  }
}

function solveIK(tx,ty){
  const bx=BASE_X(),by=BASE_Y();
  const maxReach=Math.hypot(tx-bx,ty-by)*1.05;
  const L1=maxReach*.56,L2=maxReach*.44;
  const dx=tx-bx,dy=ty-by;
  const d=clamp(Math.hypot(dx,dy),5,L1+L2-3);
  const ang=Math.atan2(dy,dx);
  const cosA=clamp((L1*L1+d*d-L2*L2)/(2*L1*d),-1,1);
  const al=Math.acos(cosA);
  return{bx,by,ex:bx+L1*Math.cos(ang-al),ey:by+L1*Math.sin(ang-al),tx,ty};
}

function drawToolStation(){
  const bx=BASE_X(),by=BASE_Y();
  const unit=Math.min(W,H)*.012;
  const sw=unit*14,sh=unit*7;
  const sx=bx-unit*18,sy=by-sh*.5;
  ctx.save();
  ctx.shadowBlur=6;ctx.shadowColor='rgba(0,200,255,.25)';
  ctx.fillStyle='#060e1e';ctx.strokeStyle='rgba(0,200,255,.35)';ctx.lineWidth=1.2;
  ctx.beginPath();ctx.roundRect(sx,sy,sw,sh,3);ctx.fill();ctx.stroke();
  ctx.fillStyle='#081828';ctx.strokeStyle='rgba(0,200,255,.2)';ctx.lineWidth=.8;
  ctx.beginPath();ctx.roundRect(sx,sy,sw,sh*.2,2);ctx.fill();ctx.stroke();
  const slotW=sw*.42,slotH=sh*.62;
  [{label:'W',idx:0},{label:'P',idx:1}].forEach((slot,si)=>{
    const slotX=sx+sw*(si===0?.06:.52);
    const slotY=sy+sh*.24;
    const active=(si===0&&toolMode==='welder')||(si===1&&toolMode==='painter');
    ctx.fillStyle='#040c18';
    ctx.strokeStyle=active?'rgba(0,200,255,.7)':'rgba(0,200,255,.18)';
    ctx.lineWidth=active?1.5:1;
    ctx.shadowBlur=active?10:2;ctx.shadowColor='#00C8FF';
    ctx.beginPath();ctx.roundRect(slotX,slotY,slotW,slotH,2);ctx.fill();ctx.stroke();
    const tx2=slotX+slotW/2;
    if(si===0){
      ctx.fillStyle=active?'rgba(0,200,255,.2)':'rgba(255,255,255,.04)';
      ctx.strokeStyle=active?'rgba(0,200,255,.5)':'rgba(255,255,255,.15)';
      ctx.lineWidth=1;ctx.shadowBlur=0;
      ctx.beginPath();ctx.roundRect(tx2-unit*1.2,slotY+sh*.06,unit*2.4,slotH*.55,1.5);ctx.fill();ctx.stroke();
      ctx.fillStyle=active?'#00C8FF':'rgba(200,200,200,.25)';
      ctx.beginPath();ctx.arc(tx2,slotY+sh*.1,unit*.6,0,Math.PI*2);ctx.fill();
    }else{
      ctx.fillStyle=active?'rgba(0,200,255,.2)':'rgba(255,255,255,.04)';
      ctx.strokeStyle=active?'rgba(0,200,255,.5)':'rgba(255,255,255,.15)';
      ctx.lineWidth=1;ctx.shadowBlur=0;
      ctx.beginPath();ctx.roundRect(tx2-unit*1.3,slotY+sh*.06,unit*2.6,slotH*.55,2);ctx.fill();ctx.stroke();
      ctx.fillStyle=active?'#00C8FF':'rgba(200,200,200,.25)';
      ctx.beginPath();ctx.roundRect(tx2-unit*.4,slotY+sh*.02,unit*.8,sh*.1,1);ctx.fill();
    }
    ctx.fillStyle=active?'#00C8FF':'rgba(212,168,37,.12)';
    ctx.shadowBlur=active?7:0;ctx.shadowColor='#00C8FF';
    ctx.beginPath();ctx.arc(slotX+slotW*.5,sy+sh*.1,unit*.3,0,Math.PI*2);ctx.fill();
    ctx.fillStyle=active?'rgba(0,200,255,.7)':'rgba(0,200,255,.2)';
    ctx.font=`bold ${unit*.9}px Rajdhani`;ctx.textAlign='center';ctx.shadowBlur=0;
    ctx.fillText(si===0?'SPAW':'LAK',tx2,slotY+slotH+sh*.18);
  });
  ctx.fillStyle='rgba(0,200,255,.18)';
  ctx.font=`${unit*.8}px Rajdhani`;ctx.textAlign='center';ctx.shadowBlur=0;
  ctx.fillText('STACJA',sx+sw/2,sy+sh+sh*.36);
  ctx.restore();
}

let toolMode='welder';
let swapping=false,swapT=0;
let gripOpen=1;

function drawSeg(x1,y1,x2,y2,w){
  ctx.save();ctx.lineCap='round';
  ctx.shadowBlur=0;ctx.shadowColor='transparent';
  ctx.strokeStyle='#010608';ctx.lineWidth=w+12;
  ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();
  ctx.shadowBlur=w*2;ctx.shadowColor='rgba(0,200,200,.7)';
  ctx.strokeStyle='#0a1828';ctx.lineWidth=w+2;
  ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();
  ctx.shadowBlur=0;
  ctx.strokeStyle='#0d2240';ctx.lineWidth=w;
  ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();
  ctx.strokeStyle='#1a4268';ctx.lineWidth=w*.6;
  ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();
  ctx.shadowBlur=w;ctx.shadowColor='rgba(0,220,210,.6)';
  ctx.strokeStyle='rgba(0,210,200,.35)';ctx.lineWidth=w*.25;
  ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();
  ctx.shadowBlur=0;
  ctx.strokeStyle='rgba(80,255,240,.6)';ctx.lineWidth=w*.09;
  ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();
  if(w>8){
    const len=Math.hypot(x2-x1,y2-y1)||1;
    const nx=(y2-y1)/len*w*.44,ny=-(x2-x1)/len*w*.44;
    ctx.save();ctx.globalAlpha=.38;ctx.strokeStyle='#060f1a';ctx.lineWidth=w*.16;
    ctx.setLineDash([5,8]);ctx.lineCap='butt';
    ctx.beginPath();ctx.moveTo(x1+nx,y1+ny);ctx.lineTo(x2+nx,y2+ny);ctx.stroke();
    ctx.setLineDash([]);ctx.restore();
  }
  ctx.restore();
}

function drawJoint(x,y,r){
  ctx.shadowBlur=12;ctx.shadowColor='#00D4CC';
  ctx.fillStyle='#060e1e';ctx.strokeStyle='#0e2848';ctx.lineWidth=2.5;
  ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();ctx.stroke();
  ctx.strokeStyle='#00D4CC';ctx.lineWidth=1.4;
  ctx.beginPath();ctx.arc(x,y,r*.72,0,Math.PI*2);ctx.stroke();
  ctx.fillStyle='#152030';
  ctx.beginPath();ctx.arc(x,y,r*.5,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#00D4CC';
  ctx.beginPath();ctx.arc(x,y,r*.19,0,Math.PI*2);ctx.fill();
  for(let i=0;i<6;i++){
    const a=i*Math.PI/3;
    ctx.save();ctx.globalAlpha=.38;ctx.strokeStyle='#00D4CC';ctx.lineWidth=.9;
    ctx.beginPath();
    ctx.moveTo(x+Math.cos(a)*r*.54,y+Math.sin(a)*r*.54);
    ctx.lineTo(x+Math.cos(a)*r*.69,y+Math.sin(a)*r*.69);
    ctx.stroke();ctx.restore();
  }
}

function drawGripper(tx,ty,armAngle,open){
  const r=Math.min(W,H)*.014;
  const perpA=armAngle+Math.PI/2;
  const spread=r*(1+open*.8);
  ctx.save();ctx.shadowBlur=10;ctx.shadowColor='#00C8FF';
  ctx.fillStyle='#0a1c32';ctx.strokeStyle='#00C8FF';ctx.lineWidth=1.5;
  ctx.beginPath();ctx.arc(tx,ty,r,0,Math.PI*2);ctx.fill();ctx.stroke();
  ctx.fillStyle='rgba(0,200,255,.6)';
  ctx.beginPath();ctx.arc(tx,ty,r*.3,0,Math.PI*2);ctx.fill();
  [1,-1].forEach(side=>{
    const fx=tx+Math.cos(perpA)*spread*side;
    const fy=ty+Math.sin(perpA)*spread*side;
    const ftx=fx+Math.cos(armAngle)*r*1.4;
    const fty=fy+Math.sin(armAngle)*r*1.4;
    ctx.strokeStyle='#0a2848';ctx.lineWidth=r*.55;ctx.lineCap='round';
    ctx.beginPath();ctx.moveTo(fx,fy);ctx.lineTo(ftx,fty);ctx.stroke();
    ctx.strokeStyle='#00C8FF';ctx.lineWidth=.9;
    ctx.beginPath();ctx.moveTo(fx,fy);ctx.lineTo(ftx,fty);ctx.stroke();
    ctx.fillStyle='#00C8FF';ctx.shadowBlur=5;
    ctx.beginPath();ctx.arc(ftx,fty,r*.2,0,Math.PI*2);ctx.fill();
  });
  ctx.restore();
}

function drawWelder(tx,ty,armAngle,active){
  const r=Math.min(W,H)*.015;
  ctx.save();ctx.shadowBlur=active?20:8;ctx.shadowColor='#F0C84A';
  ctx.fillStyle='#182840';ctx.strokeStyle='#D4A825';ctx.lineWidth=1.4;
  ctx.beginPath();ctx.roundRect(tx-r*.5,ty-r*2.4,r*1,r*1.9,r*.28);ctx.fill();ctx.stroke();
  ctx.fillStyle='#253e5a';ctx.strokeStyle='rgba(212,168,37,.35)';ctx.lineWidth=.8;
  ctx.beginPath();ctx.roundRect(tx-r*.5,ty-r*2.4,r*1,r*.45,r*.2);ctx.fill();ctx.stroke();
  ctx.fillStyle='#1d304a';ctx.strokeStyle='#D4A825';ctx.lineWidth=1.2;
  ctx.beginPath();ctx.arc(tx,ty-r*2.4,r*.42,0,Math.PI*2);ctx.fill();ctx.stroke();
  ctx.save();ctx.globalAlpha=.38;ctx.strokeStyle='#5a3800';ctx.lineWidth=r*.32;
  ctx.beginPath();ctx.moveTo(tx+r*.5,ty-r*1.3);
  ctx.quadraticCurveTo(tx+r*2,ty-r*.4,tx+r*2.4,ty+r*.8);ctx.stroke();ctx.restore();
  if(active){
    const fl=.4+.6*Math.sin(Date.now()*.16);
    ctx.globalAlpha=fl;
    ctx.fillStyle='#fff';ctx.shadowBlur=40;ctx.shadowColor='#F0C84A';
    ctx.beginPath();ctx.arc(tx,ty-r*2.4,r*.5,0,Math.PI*2);ctx.fill();
    ctx.globalAlpha=fl*.45;ctx.fillStyle='#F0C84A';ctx.shadowBlur=65;
    ctx.beginPath();ctx.arc(tx,ty-r*2.4,r*1.2,0,Math.PI*2);ctx.fill();
  }
  ctx.restore();
}

function drawPainter(tx,ty,armAngle,active){
  const r=Math.min(W,H)*.015;
  ctx.save();ctx.shadowBlur=active?18:7;ctx.shadowColor='#D4A825';
  ctx.fillStyle='#18281a';ctx.strokeStyle='#D4A825';ctx.lineWidth=1.6;
  ctx.beginPath();ctx.roundRect(tx-r*.7,ty-r*2.8,r*1.4,r*2.2,r*.38);ctx.fill();ctx.stroke();
  ctx.fillStyle='rgba(212,168,37,.18)';
  ctx.beginPath();ctx.roundRect(tx-r*.7,ty-r*2,r*1.4,r*.52,0);ctx.fill();
  ctx.fillStyle='#182218';ctx.strokeStyle='#D4A825';ctx.lineWidth=1.4;
  ctx.beginPath();ctx.roundRect(tx-r*.28,ty-r*3.38,r*.56,r*.75,r*.18);ctx.fill();ctx.stroke();
  ctx.fillStyle='#D4A825';ctx.shadowBlur=10;
  ctx.beginPath();ctx.arc(tx,ty-r*3.38,r*.28,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#0a1209';ctx.strokeStyle='rgba(212,168,37,.32)';ctx.lineWidth=.9;
  ctx.beginPath();ctx.arc(tx,ty-r*1.72,r*.3,0,Math.PI*2);ctx.fill();ctx.stroke();
  const ga=active?-Math.PI*.12:-Math.PI*.62;
  ctx.strokeStyle='#D4A825';ctx.lineWidth=1.1;
  ctx.beginPath();ctx.moveTo(tx,ty-r*1.72);
  ctx.lineTo(tx+Math.cos(ga)*r*.24,ty-r*1.72+Math.sin(ga)*r*.24);ctx.stroke();
  if(active){
    const fl=.38+.62*Math.sin(Date.now()*.2);
    ctx.globalAlpha=fl*.16;ctx.fillStyle='#D4A825';
    ctx.beginPath();ctx.moveTo(tx-r*.28,ty-r*3.38);
    ctx.lineTo(tx-r*1.8,ty-r*6.5);ctx.lineTo(tx+r*1.8,ty-r*6.5);ctx.closePath();ctx.fill();
    ctx.globalAlpha=fl*.72;ctx.fillStyle='#D4A825';ctx.shadowBlur=22;ctx.shadowColor='#D4A825';
    ctx.beginPath();ctx.arc(tx,ty-r*3.55,r*.26,0,Math.PI*2);ctx.fill();
  }
  ctx.restore();
}

function drawArm(tx,ty,phase2,subphase2){
  const{bx,by,ex,ey}=solveIK(tx,ty);
  ctx.shadowBlur=0;ctx.shadowColor='transparent';
  const armAngle=Math.atan2(ty-ey,tx-ex);
  const sw=Math.min(W,H)*.036,lw=Math.min(W,H)*.028;
  ctx.save();
  const pw=Math.min(W,H)*.11;
  ctx.shadowBlur=12;ctx.shadowColor='#00D4CC';
  ctx.fillStyle='#060e20';ctx.strokeStyle='#00D4CC';ctx.lineWidth=1.8;
  ctx.beginPath();ctx.roundRect(bx-pw/2,by-11,pw,22,5);ctx.fill();ctx.stroke();
  ctx.save();ctx.globalAlpha=.3;ctx.strokeStyle='#D4A825';ctx.lineWidth=.9;
  [-1,1].forEach(s=>{ctx.beginPath();ctx.moveTo(bx+s*pw*.26,by-4);ctx.lineTo(bx+s*pw*.26,by+4);ctx.stroke();});
  const led=(phase2==='dwell'||phase2==='carry'||phase2==='paint');
  const blinkOn=led?(Math.sin(Date.now()*.008)>0):false;
  ctx.save();
  ctx.globalAlpha=blinkOn?1:.1;
  ctx.fillStyle='#00FF44';
  ctx.shadowBlur=blinkOn?22:2;ctx.shadowColor='#00FF44';
  ctx.beginPath();ctx.arc(bx-pw*.34,by,3.2,0,Math.PI*2);ctx.fill();
  if(blinkOn){
    ctx.globalAlpha=.3;ctx.strokeStyle='#00FF44';ctx.lineWidth=1.5;
    ctx.shadowBlur=12;ctx.shadowColor='#00FF44';
    ctx.beginPath();ctx.arc(bx-pw*.34,by,6.5,0,Math.PI*2);ctx.stroke();
  }
  ctx.restore();ctx.restore();
  ctx.fillStyle='#00C8FF';ctx.shadowBlur=5;
  ctx.beginPath();ctx.arc(bx,by,4,0,Math.PI*2);ctx.fill();
  drawSeg(bx,by,ex,ey,sw);
  drawSeg(ex,ey,tx,ty,lw);
  drawJoint(bx,by,Math.min(W,H)*.027);
  drawJoint(ex,ey,Math.min(W,H)*.021);
  const wr=Math.min(W,H)*.014;
  ctx.fillStyle='#060e20';ctx.strokeStyle='#00D4CC';ctx.lineWidth=1.8;
  ctx.shadowBlur=9;ctx.shadowColor='#00C8FF';
  ctx.beginPath();ctx.arc(tx,ty,wr,0,Math.PI*2);ctx.fill();ctx.stroke();
  ctx.fillStyle='rgba(0,200,255,.65)';
  ctx.beginPath();ctx.arc(tx,ty,wr*.32,0,Math.PI*2);ctx.fill();
  if(swapping){
    ctx.save();
    if(swapT<.48){
      const d=swapT/.48;ctx.globalAlpha=1-d;
      ctx.translate(0,d*Math.min(W,H)*.055);
      drawGripper(tx,ty,armAngle,1);
    }else{
      const d=(swapT-.48)/.52;ctx.globalAlpha=d;
      ctx.translate(0,(1-d)*-Math.min(W,H)*.055);
      if(toolMode==='painter')drawPainter(tx,ty,armAngle,false);
      else drawWelder(tx,ty,armAngle,false);
    }
    ctx.restore();
  }else if(toolMode==='welder'){
    drawGripper(tx,ty,armAngle,gripOpen);
    if(phase2==='dwell'||phase2==='carry')drawWelder(tx,ty,armAngle,true);
  }else{
    drawPainter(tx,ty,armAngle,phase2==='paint');
  }
  ctx.restore();
}

let sideColors=Array(6).fill(-1);
let hexFillAlpha=0,hexRing=0,hexDot=0;

function lerpColor(a,b,t){
  return[Math.round(lerp(a[0],b[0],t)),Math.round(lerp(a[1],b[1],t)),Math.round(lerp(a[2],b[2],t))];
}

function drawHexBase(){
  if(hexFillAlpha<=0)return;
  const pts=getHex();
  ctx.save();ctx.globalAlpha=hexFillAlpha*.88;
  ctx.beginPath();pts.forEach((p,i)=>i===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y));ctx.closePath();
  const dg=ctx.createLinearGradient(CX-HR(),CY-HR(),CX+HR(),CY+HR());
  dg.addColorStop(0,'rgba(38,58,88,.96)');dg.addColorStop(1,'rgba(14,24,40,.97)');
  ctx.fillStyle=dg;ctx.fill();ctx.restore();
  const rr=HR()*.26;
  ctx.save();ctx.globalAlpha=hexFillAlpha*hexRing*.48;
  ctx.strokeStyle='rgba(212,168,37,.55)';ctx.lineWidth=1.4;ctx.shadowBlur=7;ctx.shadowColor='#D4A825';
  ctx.beginPath();ctx.arc(CX,CY,rr,0,Math.PI*2*hexRing);ctx.stroke();
  ctx.globalAlpha=hexFillAlpha*hexRing*.2;
  ctx.beginPath();ctx.arc(CX,CY,rr*1.62,-Math.PI/2,Math.PI*2*hexRing-Math.PI/2);ctx.stroke();
  ctx.restore();
  if(hexDot>0){
    const dr=HR()*.095,dot=Math.min(Math.abs(hexDot),1.1);
    ctx.save();ctx.globalAlpha=hexFillAlpha;ctx.shadowBlur=26;ctx.shadowColor='#F0C84A';
    const dg2=ctx.createRadialGradient(CX,CY,0,CX,CY,dr*dot);
    dg2.addColorStop(0,'#fff');dg2.addColorStop(.3,'#F0C84A');dg2.addColorStop(1,'#D4A825');
    ctx.fillStyle=dg2;ctx.beginPath();ctx.arc(CX,CY,dr*dot,0,Math.PI*2);ctx.fill();ctx.restore();
  }
}

function drawAllSides(){
  const pts=getHex();
  for(let i=0;i<6;i++){
    const c=sideColors[i];
    if(c<0)continue;
    const a=pts[i],b=pts[(i+1)%6];
    const col=lerpColor([255,255,255],[212,168,37],c);
    const endCol=lerpColor([200,220,255],[240,200,55],c);
    const glowAlpha=lerp(.5,.85,c);
    ctx.save();
    ctx.shadowBlur=lerp(18,14,c);
    ctx.shadowColor=`rgba(${col[0]},${col[1]},${col[2]},${glowAlpha})`;
    ctx.strokeStyle=`rgb(${col[0]},${col[1]},${col[2]})`;
    ctx.lineWidth=3;ctx.lineCap='round';
    ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
    [a,b].forEach(p=>{
      ctx.fillStyle=`rgb(${endCol[0]},${endCol[1]},${endCol[2]})`;
      ctx.shadowBlur=8;
      ctx.beginPath();ctx.arc(p.x,p.y,3.5,0,Math.PI*2);ctx.fill();
    });
    ctx.restore();
  }
}

function drawFloatingPiece(ax,ay,bx2,by2,alpha){
  ctx.save();ctx.globalAlpha=alpha;
  ctx.shadowBlur=20;ctx.shadowColor='rgba(220,235,255,.95)';
  ctx.strokeStyle='#ffffff';ctx.lineWidth=3;ctx.lineCap='round';
  ctx.beginPath();ctx.moveTo(ax,ay);ctx.lineTo(bx2,by2);ctx.stroke();
  ctx.shadowBlur=5;ctx.strokeStyle='rgba(180,210,255,.35)';ctx.lineWidth=1.1;
  ctx.beginPath();ctx.moveTo(ax,ay);ctx.lineTo(bx2,by2);ctx.stroke();
  [0,1].forEach(e=>{
    const x=e?bx2:ax,y=e?by2:ay;
    ctx.fillStyle='#cce0ff';ctx.shadowBlur=9;ctx.shadowColor='#fff';
    ctx.beginPath();ctx.arc(x,y,3.5,0,Math.PI*2);ctx.fill();
  });
  ctx.restore();
}

let phase='boot',subphase='';
let bootT=0,pieces=[],curIdx=0;
let armX=0,armY=0;
let armMT=0,armSX=0,armSY=0,armTX=0,armTY=0,armSpd=0;
let dwellT=0,colT=0,swapPhaseT=0;
let paintIdx=0,paintT2=0;
const PAINT_SPD=0.16;
let parkX=0,parkY=0;

function calcSpawn(i){
  const angles=[215,325,85,150,30,260];
  const sa=angles[i]*Math.PI/180;
  const sd=Math.min(W,H)*.32;
  return{x:CX+Math.cos(sa)*sd,y:CY+Math.sin(sa)*sd};
}

function initPieces(){
  const pts=getHex();
  sideColors=Array(6).fill(-1);
  pieces=Array.from({length:6},(_,i)=>{
    const a=pts[i],b=pts[(i+1)%6];
    const mx=(a.x+b.x)/2,my=(a.y+b.y)/2;
    const sp=calcSpawn(i);
    return{ax:a.x,ay:a.y,bx:b.x,by:b.y,mx,my,
      ox:sp.x-mx,oy:sp.y-my,placed:false,alpha:0,spx:sp.x,spy:sp.y};
  });
  parkX=CX+Math.min(W,H)*.04;
  parkY=BASE_Y()-Math.min(W,H)*.08;
}

function startMove(tx,ty,spd=.024){
  armSX=armX;armSY=armY;armTX=tx;armTY=ty;armMT=0;armSpd=spd;
  startMotor();
}
function setLabel(t){document.getElementById('phaseLabel').textContent=t;}

function tick(){
  if(phase==='boot'){
    bootT+=.09;bgAlpha=Math.min(1,bootT*.82);
    pieces.forEach(p=>{p.alpha=clamp(bootT*1.1-.2,0,1);});
    armX=BASE_X();armY=BASE_Y();
    if(bootT>=1.0){
      phase='move';subphase='toSpawn';
      startMove(pieces[0].spx,pieces[0].spy,.14);
      setLabel('Pobieranie elementów');
    }
  }else if(phase==='move'){
    armMT=Math.min(1,armMT+armSpd);
    const e=ease(armMT);
    armX=lerp(armSX,armTX,e);armY=lerp(armSY,armTY,e);
    if(armMT>=1){
      stopMotor();
      if(subphase==='toSpawn'){
        gripOpen=1;sndSpark();
        sparks(armX,armY,8,'#cce4ff',.65);
        dwellT=0;phase='dwell';subphase='pickup';
      }else if(subphase==='toBase'){
        phase='toolSwap';swapPhaseT=0;swapping=true;swapT=0;
        setLabel('Wymiana narzędzia');
      }else if(subphase==='toPaintStart'){
        phase='paint';paintIdx=0;paintT2=0;
        startPaintHiss();setLabel('Lakierowanie');
      }else if(subphase==='toPark'){
        phase='finale';colT=0;
        setLabel('System gotowy');sndWhoosh();
      }
    }
  }else if(phase==='dwell'){
    dwellT++;
    if(subphase==='pickup'){
      gripOpen=Math.max(0,1-dwellT/3);
      if(dwellT===6)sndGrip();
      if(dwellT%6===0)sparks(armX,armY,1,'#cce4ff',.3);
    }
    if(subphase==='placed'){
      if(dwellT%5===0)sparks(armX,armY,2,'#D4A825',.3);
    }
    if(dwellT>=4){
      if(subphase==='pickup'){
        const p=pieces[curIdx];
        startMove(p.mx,p.my,.13);
        phase='carry';
      }else if(subphase==='placed'){
        curIdx++;
        if(curIdx>=6){
          setLabel('Powrót do bazy');
          gripOpen=1;
          startMove(BASE_X(),BASE_Y(),.12);
          phase='move';subphase='toBase';sndWhoosh();
        }else{
          gripOpen=1;
          startMove(pieces[curIdx].spx,pieces[curIdx].spy,.14);
          phase='move';subphase='toSpawn';
        }
      }
    }
  }else if(phase==='carry'){
    armMT=Math.min(1,armMT+armSpd);
    const e=ease(armMT);
    armX=lerp(armSX,armTX,e);armY=lerp(armSY,armTY,e);
    const p=pieces[curIdx];
    p.ox=lerp(p.spx-p.mx,0,e);
    p.oy=lerp(p.spy-p.my,0,e);
    if(Math.random()<.15)sparks(armX,armY,1,'rgba(180,210,255,.5)',.28);
    if(armMT>=1){
      stopMotor();
      p.placed=true;p.ox=0;p.oy=0;
      sideColors[curIdx]=0;
      shockwave(armX,armY,'#aaccff');
      gripOpen=0;
      dwellT=0;phase='dwell';subphase='placed';
    }
  }else if(phase==='toolSwap'){
    swapPhaseT++;
    armX=BASE_X();armY=BASE_Y()-Math.min(W,H)*.05;
    swapT=clamp(swapPhaseT/10,0,1);
    if(swapPhaseT===2){sndToolSwap();sparks(armX,armY,10,'#D4A825',.9);}
    if(swapPhaseT===6){toolMode='painter';sparks(armX,armY,12,'#D4A825',1.05);sndSpark();}
    if(swapPhaseT>=12){
      swapping=false;
      hexFillAlpha=1;hexRing=1;hexDot=1;
      const pts=getHex();
      startMove(pts[0].x,pts[0].y,.13);
      phase='move';subphase='toPaintStart';
    }
  }else if(phase==='paint'){
    const pts=getHex();
    paintT2=Math.min(1,paintT2+PAINT_SPD);
    const a=pts[paintIdx],b=pts[(paintIdx+1)%6];
    armX=lerp(a.x,b.x,ease(paintT2));
    armY=lerp(a.y,b.y,ease(paintT2));
    sideColors[paintIdx]=paintT2;
    if(Math.random()<.45)paintSplash(armX,armY);
    if(paintT2>=1){
      sideColors[paintIdx]=1;
      paintIdx++;
      if(paintIdx>=6){
        stopPaintHiss();
        shockwave(CX,CY,'#D4A825');sparks(CX,CY,35,'#F0C84A',2.2);
        setLabel('Powrót do bazy');
        startMove(parkX,parkY,.12);
        phase='move';subphase='toPark';
      }else{
        paintT2=0;sparks(armX,armY,7,'#D4A825',1.05);
      }
    }
  }else if(phase==='finale'){
    colT++;
    if(colT===8){['appName','badge','appSub'].forEach(id=>document.getElementById(id).classList.add('show'));}
    if(colT===18){document.getElementById('readyWrap').classList.add('show');document.getElementById('sf').style.width='100%';sndFanfare();}
    if(colT===20){document.getElementById('created').classList.add('show');}
    if(colT===30){ const cb=window.__mlOnLogin; if(cb) cb(); }
    if(colT>480)phase='done';
  }else if(phase==='done'){
    hexDot=1+.058*Math.sin(Date.now()*.0028);
    if(Math.random()<.018)sparks(CX+rand(-HR(),HR()),CY+rand(-HR(),HR()),2,'#D4A825',.18);
  }
}

function render(){
  ctx.clearRect(0,0,W,H);
  drawHexBase();
  drawAllSides();
  pieces.forEach(p=>{
    if(p.alpha<=0||p.placed)return;
    drawFloatingPiece(p.ax+p.ox,p.ay+p.oy,p.bx+p.ox,p.by+p.oy,p.alpha);
  });
  drawParts();
  drawToolStation();
  drawArm(armX,armY,phase,subphase);
  const sl=(Date.now()*.18)%H;
  ctx.save();ctx.globalAlpha=.018;
  const slg=ctx.createLinearGradient(0,sl-38,0,sl+38);
  slg.addColorStop(0,'transparent');slg.addColorStop(.5,'#D4A825');slg.addColorStop(1,'transparent');
  ctx.fillStyle=slg;ctx.fillRect(0,sl-38,W,76);ctx.restore();
}

function restart(){
  phase='boot';subphase='';bootT=0;curIdx=0;
  armX=BASE_X();armY=BASE_Y();
  toolMode='welder';swapping=false;swapT=0;swapPhaseT=0;
  hexFillAlpha=0;hexRing=0;hexDot=0;
  sideColors=Array(6).fill(-1);
  paintIdx=0;paintT2=0;parts=[];bgAlpha=0;colT=0;dwellT=0;
  gripOpen=1;
  stopMotor();stopPaintHiss();
  ['appName','badge','appSub','readyWrap','created'].forEach(id=>document.getElementById(id).classList.remove('show'));
  document.getElementById('sf').style.width='0%';
  setLabel('');
  initPieces();
}

const _lb=document.getElementById('loginBtn');
if(_lb)_lb.addEventListener('click',function(){
  resumeAC();
  restart();
  const cb=window.__mlOnLogin;
  if(cb)setTimeout(cb,100);
});

function loop(){drawBG();tick();render();requestAnimationFrame(loop);}
initBG();initPieces();
armX=BASE_X();armY=BASE_Y();
loop();
