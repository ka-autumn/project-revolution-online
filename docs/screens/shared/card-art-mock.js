(() => {
 const script = document.currentScript;
 const image = new URL('card-art-sample.svg', script.src).href;
 function update() {
  for (const face of document.querySelectorAll('.card:not(.card--back) .card__face:not(.card-art-face)')) {
   const card = face.closest('.card'); const bottom = face.querySelector('.card__bottom'); const title=face.querySelector('.card__title');
   if (!bottom || !title) continue;
   face.classList.add('card-art-face');
   const isTrap=!!face.querySelector('.trigger-icon'); const isUnit=!!face.querySelector('.card__stats');
   face.classList.toggle('card-art-nonunit',!isUnit); face.classList.toggle('card-art-trap',isTrap);
   if (!card.classList.contains('card--拡大')) bottom.prepend(title);
   const footer=document.createElement('div'); footer.className='card-art-footer';
   for(const part of [bottom.querySelector('.card__stats'),bottom.querySelector('.card__traits')]) if(part) footer.append(part);
   if(footer.childElementCount) bottom.append(footer);
   const svg = face.querySelector('.trigger-icon');
   if(svg && svg.querySelectorAll('rect').length===10) {
    const [background,...cells]=svg.querySelectorAll('rect');background.setAttribute('fill','#4d4d4d');
    for(const cell of cells){
     const x=Number(cell.getAttribute('x')),y=Number(cell.getAttribute('y')),w=Number(cell.getAttribute('width')),h=Number(cell.getAttribute('height'));
     cell.setAttribute('rx','.15');cell.setAttribute('stroke','#b9b6b0');cell.setAttribute('stroke-width','.23');
     for(const [d,color,opacity,width] of [[`M${x+w-.23} ${y+.23}H${x+.23}V${y+h-.23}`,'#000','.68','.42'],[`M${x+.23} ${y+h-.23}H${x+w-.23}V${y+.23}`,'#fff','.58','.32']]){
      const edge=document.createElementNS('http://www.w3.org/2000/svg','path');for(const [name,value] of Object.entries({d,fill:'none',stroke:color,'stroke-opacity':opacity,'stroke-width':width,'aria-hidden':'true'}))edge.setAttribute(name,value);svg.append(edge);
     }
    }
   }
   // 架空カードにだけ使用する見本画像。
   face.style.setProperty('--card-art-image','url("'+image+'")');
   const body=face.querySelector('.card__lines');
   if(body && card.classList.contains('card--拡大')) { const flavor=document.createElement('p'); flavor.className='card-art-flavor'; flavor.textContent='【風の向こうへ、まだ見ぬ旅へ。】'; body.prepend(flavor); requestAnimationFrame(()=>{
    if(!face.isConnected)return;const overflow=Math.max(0,body.scrollHeight-body.clientHeight);
    if(overflow>1)bottom.style.height=Math.min(face.clientHeight*.45,bottom.offsetHeight+overflow+2)+'px';
   }); }
  }
 }
 new MutationObserver(update).observe(document.documentElement,{childList:true,subtree:true}); update();
})();
