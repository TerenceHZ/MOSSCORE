# MOSS-like 3D 资产 · Blender 程序化构建

这是路径 B：**原创的 MOSS-like 工业摄像单元**，不 1:1 复刻电影资产。  
白色装甲、红色镜头、悬挂云台、外露线缆、检修板、螺栓、散热口。

## 1. 安装 Blender

下载 **Blender 4.x 或 5.x**：

https://www.blender.org/download/

安装时记下路径。你的机器上已安装在：

```text
D:\Blender\blender.exe
```

## 2. 一键构建

双击：

```text
D:\数据库\构建MOSS.bat
```

或者在 Blender 界面里：

1. 打开 `Scripting`
2. 打开 `D:\数据库\3d\moss_build_v2.py`
3. 点 `Run Script`

## 3. 输出

成功后得到：

```text
D:\数据库\3d\moss-preview-v2.png
D:\数据库\3d\moss-wireframe-v2.png
D:\数据库\3d\moss-hologram-v2.png
D:\数据库\3d\moss-v2.glb
D:\数据库\3d\moss-v2.blend
```

- `moss-hologram-v2.png`：550C 琥珀/青色全息线框版，先看这个
- `moss-v2.glb`：给 Three.js / 客户端用
- `moss-preview-v2.png`：实体白装甲参考
- `moss-v2.blend`：可继续改模型

## 4. 这一步的验收

只看 `moss-preview-v2.png`：

- 白色装甲有没有工业重量感
- 红色镜头有没有成为视觉中心
- 云台、线缆、螺栓、检修板有没有层次
- 光有没有打出金属和白色装甲的质感

如果 MOSS 本体质感不对，先不要加窗口。  
MOSS 通过后，再进入 Three.js 场景：左右玻璃控制台 + 底部指挥台 + 运动。

## 5. 可能需要调的地方

- 白色装甲偏灰/偏亮
- 红色镜头过曝
- 镜头太小或太大
- 云台比例
- 线缆走向
- 相机取景

把 `moss-preview-v2.png` 发回来，我按图调参数。

## 6. 版权

这是原创的 MOSS-like 设计：白色悬挂机械摄像单元、红色镜头、工业装甲。  
不直接复制电影《流浪地球》中 MOSS 的具体造型与资产。
