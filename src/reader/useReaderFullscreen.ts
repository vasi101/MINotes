import {useCallback,useEffect,useRef,useState} from 'react';
import {isTauri} from '@tauri-apps/api/core';
import {getCurrentWindow} from '@tauri-apps/api/window';
export function useReaderFullscreen(){
  const element=useRef<HTMLDivElement>(null);
  const [fullscreen,setFullscreen]=useState(false),[fullscreenError,setError]=useState('');
  const ownedNative=useRef(false),restoreMaximized=useRef(false),busy=useRef(false);
  const restoreNative=useCallback(async()=>{
    const window=getCurrentWindow();
    if(ownedNative.current){await window.setFullscreen(false);ownedNative.current=false}
    if(restoreMaximized.current){await window.maximize();restoreMaximized.current=false}
  },[]);
  const exit=useCallback(async()=>{
    try{
      if(isTauri())await restoreNative();
      else if(document.fullscreenElement)await document.exitFullscreen();
      setFullscreen(false);
    }catch(error){setError(error instanceof Error?error.message:String(error))}
  },[restoreNative]);
  const enter=useCallback(async()=>{
    if(busy.current)return;busy.current=true;setError('');
    try{
      if(isTauri()){
        const window=getCurrentWindow();const previous=await window.isFullscreen();
        if(!previous){
          // Leave the maximized work area before entering monitor-sized fullscreen.
          // Otherwise Windows/WebView2 can retain the taskbar-sized client bounds.
          restoreMaximized.current=await window.isMaximized();
          if(restoreMaximized.current)await window.unmaximize();
          try {await window.setFullscreen(true);ownedNative.current=true}
          catch(error){await restoreNative();throw error}
        }
      }else{if(!element.current?.requestFullscreen)throw new Error('Fullscreen is unavailable in this browser.');await element.current.requestFullscreen()}
      setFullscreen(true);
    }catch(error){setError(error instanceof Error?error.message:String(error))}finally{busy.current=false}
  },[restoreNative]);
  useEffect(()=>{document.body.classList.toggle('reader-is-fullscreen',fullscreen);return()=>document.body.classList.remove('reader-is-fullscreen')},[fullscreen]);
  useEffect(()=>{
    const changed=()=>{if(!isTauri())setFullscreen(document.fullscreenElement===element.current)};
    document.addEventListener('fullscreenchange',changed);
    return()=>{document.removeEventListener('fullscreenchange',changed);if(ownedNative.current||restoreMaximized.current)void restoreNative().catch(()=>{});else if(document.fullscreenElement===element.current)void document.exitFullscreen().catch(()=>{})};
  },[restoreNative]);
  useEffect(()=>{const key=(event:KeyboardEvent)=>{if(event.key==='Escape'&&fullscreen){event.preventDefault();void exit()}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[fullscreen,exit]);
  return {element,fullscreen,fullscreenError,enter,exit};
}
