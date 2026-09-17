"""Package existing generated parts; pixels are not redrawn. Native project is read only."""
from pathlib import Path
import json
import cv2
import numpy as np
from PIL import Image

HERE=Path(__file__).resolve().parent
SRC=HERE.parent/'live2d-authoring/fine/layers'
OUT=HERE/'assets'
W,H=940,1674
layers=[]
def put(name,img):
    path=f'layer-{len(layers):02d}.png'
    img.save(OUT/path)
    layers.append(dict(name=name,file=path))
def source(name): return Image.open(SRC/f'{name}.png').convert('RGBA')
def at_part(img,width,x,y):
    img=img.crop(img.getbbox())
    img=img.resize((width,round(img.height*width/img.width)),Image.Resampling.LANCZOS)
    result=Image.new('RGBA',(W,H));result.paste(img,(x,y));return result

back=Image.open(OUT/'back-hair-source.png').convert('RGBA')
back=back.resize((W,H),Image.Resampling.LANCZOS)
b=np.asarray(back).copy();rgb=b[:,:,:3].astype(float)
warm=((rgb[:,:,0]>rgb[:,:,1]*1.22)&(rgb[:,:,0]>rgb[:,:,2]*1.6))|(rgb.max(2)<90)
contours,_=cv2.findContours(warm.astype('uint8')*255,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
mask=np.zeros((H,W),np.uint8);cv2.drawContours(mask,[max(contours,key=cv2.contourArea)],-1,255,-1)
b[:,:,3]=cv2.erode(mask,np.ones((3,3),np.uint8));put('back hair_1',Image.fromarray(b))
put('neck',at_part(source('Neck'),184,377,584))
put('topwear',source('Body'))

# Extract the connected existing skin area, including its original ink edge.
head=np.asarray(source('HeadBase')).copy();rgb=head[:,:,:3].astype(int)
skin=((rgb[:,:,0]>155)&(rgb[:,:,1]>130)&(rgb[:,:,2]>110)&(rgb[:,:,0]-rgb[:,:,2]>15)&(head[:,:,3]>100)).astype('uint8')
_,labels=cv2.connectedComponents(skin)
face=np.uint8(labels==labels[450,470])*255
face=cv2.dilate(face,np.ones((5,5),np.uint8))
head[:,:,3]=np.minimum(head[:,:,3],face);put('face',Image.fromarray(head))
for side in ['L','R']:
    for a,b in [('EyeWhite','eyewhite'),('EyeBall','irides'),('EyeUpper','eyelash'),('EyeLower','eyelash'),('Brow','eyebrow')]:
        img=source(a+side)
        if a=='EyeLower':img.putalpha(img.getchannel('A').point(lambda v:round(v*.22)))
        put(b,img)
eyes=Image.open(OUT/'eyes-closed-source.png').convert('RGBA')
for i,x in enumerate([275,518]):
    half=eyes.crop((i*eyes.width//2,0,(i+1)*eyes.width//2,eyes.height))
    put('eye_close',at_part(half,137,x,456))
put('mouth_close',source('MouthClosed'))
put('mouth_open_1',source('MouthCavity'))
put('mouth_open_2',source('MouthTeeth'))
put('mouth_open_3',source('MouthTongue'))
for a,n in [('HairFrontL','front hair_1'),('HairFrontR','front hair_2'),('HairBangs','front hair_3')]:put(n,source(a))
(OUT/'layers.json').write_text(json.dumps(dict(width=W,height=H,layers=layers),ensure_ascii=False,indent=2))
composite=Image.new('RGBA',(W,H))
for layer in layers:
    if layer['name']=='eye_close' or layer['name'].startswith('mouth_open'):continue
    composite.alpha_composite(Image.open(OUT/layer['file']))
composite.save(OUT/'assembled.png')
print(json.dumps(dict(layers=len(layers),faceBounds=Image.fromarray(face).getbbox(),eyesAlpha=eyes.getchannel('A').getextrema())))
