"""Crop generated component sheets, remove neutral background, uniformly place PSD layers.

This only packages imagegen artwork. No features are drawn or locally reshaped.
"""
from pathlib import Path
import json
import cv2
import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
SIZE = (940, 1674)
OUT = HERE / 'layers'
OUT.mkdir(exist_ok=True)
report = []
layers = {}

def extract(sheet, col, row, cols, rows):
    filename = 'mouth-clean-sheet.png' if sheet == 'mouth' else sheet + '-sheet.png'
    image = Image.open(HERE / 'sources' / filename).convert('RGBA')
    w,h = image.size
    top,bottom = [(20,175),(185,415),(430,665),(675,990),(1040,1190)][row] if sheet == 'eyes' else (round(h*row/rows),round(h*(row+1)/rows))
    part = np.asarray(image.crop((round(w*col/cols),top,round(w*(col+1)/cols),bottom))).copy()
    rgb = part[:,:,:3].astype(np.int16)
    mask = np.uint8((rgb.max(2)-rgb.min(2)>(3 if sheet == 'eyes' and row == 2 else 9)) | (rgb.min(2)<180))*255
    if sheet in ('mouth', 'neck'):
        mask=np.uint8(~((rgb[:,:,1]>rgb[:,:,0]*1.4)&(rgb[:,:,1]>rgb[:,:,2]*1.4)))*255
    contours,_ = cv2.findContours(mask,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
    shape = max(contours,key=cv2.contourArea)
    alpha = np.zeros(mask.shape,np.uint8)
    cv2.drawContours(alpha,[shape],-1,255,cv2.FILLED)
    if sheet == 'mouth' and (row != 1 or col == 1):
        alpha=cv2.bitwise_and(alpha,mask)
    x,y,w,h = cv2.boundingRect(shape)
    part[:,:,3] = cv2.GaussianBlur(alpha,(3,3),.4)
    return Image.fromarray(part).crop((max(0,x-2),max(0,y-2),x+w+2,y+h+2))

def place(name,sheet,col,row,cols,rows,width,x,y):
    part=extract(sheet,col,row,cols,rows)
    scale=width/part.width
    part=part.resize((round(width),round(part.height*scale)),Image.Resampling.LANCZOS)
    layer=Image.new('RGBA',SIZE)
    layer.paste(part,(round(x),round(y)))
    layers[name]=layer
    report.append(dict(name=name,sheet=sheet,cell=[col,row],scale=scale,position=[x,y],size=list(part.size)))

def original_part(name,source,scale=1,shift=(0,0)):
    a=np.asarray(Image.open(HERE/'sources'/source).convert('RGBA')).copy()
    rgb=a[:,:,:3].astype(np.int16)
    mask=np.uint8((rgb.max(2)-rgb.min(2)>15)|(rgb.min(2)<155))*255
    if name.startswith('Hair'):
        # The generated sheet has a painted checkerboard with tinted edge
        # pixels. Keep warm hair and dark ink, not the neutral matte fringe.
        mask=np.uint8(((rgb[:,:,0]>rgb[:,:,1]*1.22)&
                       (rgb[:,:,0]>rgb[:,:,2]*1.6))|
                      (rgb.max(2)<95))*255
    contours,_=cv2.findContours(mask,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
    alpha=np.zeros(mask.shape,np.uint8)
    cv2.drawContours(alpha,[max(contours,key=cv2.contourArea)],-1,255,cv2.FILLED)
    if name.startswith('Hair'):
        alpha=cv2.bitwise_and(alpha,mask)
    a[:,:,3]=cv2.erode(alpha,np.ones((3,3),np.uint8))
    a=cv2.warpAffine(a,np.float32([[scale,0,shift[0]],[0,scale,shift[1]]]),SIZE,flags=cv2.INTER_LANCZOS4)
    layers[name]=Image.fromarray(a)
    report.append(dict(name=name,source=source,scale=scale,translation=shift))

layers['Body']=Image.open(HERE.parent / 'layers/body.png').convert('RGBA')
# Separate the original collar from the old neck and its opaque matte.
# Only alpha is cut; all retained clothing pixels stay unchanged.
body=np.asarray(layers['Body']).copy()
collar_cut=np.array([(0,0),(939,0),(939,665),(555,665),
    (550,695),(539,708),(510,727),(482,738),(472,744),
    (461,744),(452,739),(430,729),(404,715),(385,697),
    (380,665),(0,665)],np.int32)
cut=np.zeros(body.shape[:2],np.uint8)
cv2.fillPoly(cut,[collar_cut],255)
body[:,:,3][cut>0]=0
layers['Body']=Image.fromarray(body)
place('Neck','neck',0,0,1,1,184,377,566)
original_part('HeadBase','head-base.png',1,(0,2))
# Isolate existing lower back-hair pixels for an underlay behind the collar.
# Its independent mesh can overlap the shoulder without distorting the face.
back=np.asarray(layers['HeadBase']).copy()
rgb=back[:,:,:3].astype(np.float32)
hair=(rgb[:,:,0]>rgb[:,:,1]*1.45)&(rgb[:,:,0]>rgb[:,:,2]*1.6)
hair=cv2.erode(hair.astype(np.uint8),np.ones((3,3),np.uint8))
back[:,:,3]=back[:,:,3]*hair
back[:640,:,3]=0
back[:,:260,3]=0
back[:,675:,3]=0
layers['HairBackFill']=Image.fromarray(back)
for side,col,x in [('L',0,280),('R',1,523)]:
    place('EyeWhite'+side,'eyes',col,2,2,5,112,x+8,421)
    place('EyeBall'+side,'eyes',col,3,2,5,86,x+20,410)
    place('EyeLower'+side,'eyes',col,4,2,5,92,x+17,478)
    place('EyeUpper'+side,'eyes',col,1,2,5,137,x-5,407)
    place('Brow'+side,'eyes',col,0,2,5,98,x+10,368)
place('MouthCavity','mouth',0,1,2,3,45,443,624)
place('MouthTeeth','mouth',1,1,2,3,40,445,625)
place('MouthTongue','mouth',0,2,2,3,23,454,632)
place('MouthUpper','mouth',0,0,2,3,49,441,622)
place('MouthLower','mouth',1,0,2,3,45,443,638)
place('MouthClosed','mouth',1,2,2,3,48,441,632)
original_part('HairFrontL','hair-left.png',.78,(55,0))
original_part('HairFrontR','hair-right.png',.92,(58,-4))
original_part('HairBangs','hair-bangs.png',.98,(8,0))

# Uniform color calibration of each generated hair layer against unchanged
# source hair pixels; mesh deformation is authored separately in Cubism.
reference=np.asarray(Image.open(HERE.parent/'layers/head.png').convert('RGBA'))
for name in ['HairBangs','HairFrontL','HairFrontR']:
    data=np.asarray(layers[name]).copy()
    a=data[:,:,:3].astype(np.float32)
    b=reference[:,:,:3].astype(np.float32)
    valid=(data[:,:,3]>245)&(reference[:,:,3]>245)&(b[:,:,0]>b[:,:,1]*1.4)&(a[:,:,0]>a[:,:,1]*1.4)
    gain=np.median(b[valid],axis=0)/np.median(a[valid],axis=0)
    data[:,:,:3]=np.clip(a*gain,0,255).astype(np.uint8)
    layers[name]=Image.fromarray(data)
    report.append(dict(name=name,colorGain=gain.tolist()))

for name,layer in layers.items():
    layer.save(OUT/(name+'.png'))
preview=Image.new('RGBA',SIZE)
for name,layer in layers.items():
    if name in ('MouthCavity','MouthTeeth','MouthTongue','MouthUpper','MouthLower'):
        continue
    if name.startswith('EyeBall'):
        # Preview uses the same sclera clipping the Cubism ArtMesh will use.
        data=np.asarray(layer).copy()
        alpha=np.asarray(layers['EyeWhite'+name[-1]])[:,:,3]
        data[:,:,3]=(data[:,:,3].astype(np.uint16)*alpha/255).astype(np.uint8)
        layer=Image.fromarray(data)
    if name.startswith('EyeLower'):
        layer=layer.copy()
        layer.putalpha(layer.getchannel('A').point(lambda x:round(x*.22)))
    preview=Image.alpha_composite(preview,layer)
preview.save(HERE/'assembled-preview.png')
(HERE/'layers.json').write_text(json.dumps(dict(canvas=SIZE,layers=list(layers),placement=report),indent=2),encoding='utf-8')
print(json.dumps(report,indent=2))
