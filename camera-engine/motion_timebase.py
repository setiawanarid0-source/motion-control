#!/usr/bin/env python3
"""Convert arbitrary constant-frame-rate driving videos to 35 FPS without frame duplication.

Uses optical-flow interpolation of adjacent source frames. The temporal path is sampled
at the original timestamps; this does not stabilize/shake-suppress any camera motion.
This is preconditioning only: generated subject jitter and 3-D camera errors remain
model-dependent and must be checked against actual RunningHub outputs.
"""
import argparse,json,math,subprocess,sys,time
import cv2,numpy as np
cv2.setNumThreads(2)
TARGET_FPS=35

def convert(input_path,out_path,max_width=720):
    cap=cv2.VideoCapture(input_path)
    if not cap.isOpened():raise ValueError('Cannot read source video')
    fps=float(cap.get(cv2.CAP_PROP_FPS));count=int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    w0=int(cap.get(cv2.CAP_PROP_FRAME_WIDTH));h0=int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    if not (8<=fps<=120 and 3<=count<=3600 and w0>0 and h0>0):
        raise ValueError('Unsupported source video metadata')
    w=max(2,(min(w0,max_width)//2)*2)
    h=max(2,int(round(w*h0/w0/2)*2))
    if h>1920 or w*h>1600000:raise ValueError('Oversized source motion')
    def read():
        ok,frame=cap.read()
        if not ok:return None
        if (w,h)!=(w0,h0):frame=cv2.resize(frame,(w,h),interpolation=cv2.INTER_AREA)
        return frame
    A=read();B=read();idx=0
    if A is None or B is None:raise ValueError('Too few frames')
    target_count=int(round(count*TARGET_FPS/fps))
    flow=cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_FAST)
    sw=160;sh=max(2,int(round(sw*h/w/2)*2))
    x,y=np.meshgrid(np.arange(w,dtype=np.float32),np.arange(h,dtype=np.float32))
    f=b=None;synth=0;started=time.monotonic()
    cmd=['ffmpeg','-hide_banner','-loglevel','error','-nostdin','-y',
         '-f','rawvideo','-pixel_format','bgr24','-video_size',f'{w}x{h}',
         '-framerate',str(TARGET_FPS),'-i','pipe:0','-i',input_path,
         '-map','0:v:0','-map','1:a?','-c:v','libx264','-preset','veryfast','-crf','18',
         '-pix_fmt','yuv420p','-c:a','aac','-b:a','128k','-movflags','+faststart',out_path]
    ff=subprocess.Popen(cmd,stdin=subprocess.PIPE,stderr=subprocess.PIPE)
    try:
        for i in range(target_count):
            t=i*fps/TARGET_FPS
            desired=min(int(math.floor(t)),count-1)
            while idx<desired:
                idx+=1;A=B;B=read();f=b=None
            if B is None:B=A
            alpha=t-desired
            if alpha<.005 or B is A:frame=A
            elif fps>=TARGET_FPS:
                # For >35fps inputs pick a genuine captured frame; don't invent motion.
                frame=A if alpha<.5 else B
            else:
                if f is None:
                    a=cv2.cvtColor(cv2.resize(A,(sw,sh)),cv2.COLOR_BGR2GRAY)
                    bb=cv2.cvtColor(cv2.resize(B,(sw,sh)),cv2.COLOR_BGR2GRAY)
                    forward=cv2.resize(flow.calc(a,bb,None),(w,h),interpolation=cv2.INTER_LINEAR)
                    backward=cv2.resize(flow.calc(bb,a,None),(w,h),interpolation=cv2.INTER_LINEAR)
                    factor=np.array([w/sw,h/sh],np.float32)
                    f=forward*factor;b=backward*factor
                F=cv2.remap(A,x-alpha*f[:,:,0],y-alpha*f[:,:,1],cv2.INTER_LINEAR,borderMode=cv2.BORDER_REPLICATE)
                G=cv2.remap(B,x-(1-alpha)*b[:,:,0],y-(1-alpha)*b[:,:,1],cv2.INTER_LINEAR,borderMode=cv2.BORDER_REPLICATE)
                frame=cv2.addWeighted(F,1-alpha,G,alpha,0)
                synth+=1
            ff.stdin.write(frame.tobytes())
        ff.stdin.close()
        stderr=ff.stderr.read().decode(errors='replace')
        if ff.wait(timeout=90):raise RuntimeError('Video encoding failed: '+stderr[-400:])
    except Exception:
        try:ff.kill()
        except:pass
        try:ff.wait(timeout=5)
        except:pass
        raise
    finally:cap.release()
    return dict(original_fps=round(fps,4),output_fps=TARGET_FPS,source_frames=count,
        output_frames=target_count,interpolated_frames=synth,
        source_resolution=[w0,h0],output_resolution=[w,h],
        seconds=round(time.monotonic()-started,2))

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('source');parser.add_argument('output')
    parser.add_argument('--width',type=int,default=720)
    args=parser.parse_args()
    try:print(json.dumps(convert(args.source,args.output,args.width)))
    except Exception as ex:
        print(str(ex),file=sys.stderr)
        sys.exit(1)
