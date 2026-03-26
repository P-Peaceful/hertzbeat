# issue 4034 后端逻辑 diff 说明

> 说明范围：**仅检查后端生产代码逻辑变动**，不包含前端与测试代码。
> 涉及文件：
> - `hertzbeat-manager/src/main/java/org/apache/hertzbeat/manager/controller/StatusPagePublicController.java`
> - `hertzbeat-manager/src/main/java/org/apache/hertzbeat/manager/service/StatusPageService.java`
> - `hertzbeat-manager/src/main/java/org/apache/hertzbeat/manager/service/impl/StatusPageServiceImpl.java`

---

## 一、改动目标概述

这次后端改动的目标，是让状态页公开接口里的 **component 状态历史** 不再只能返回固定 30 天窗口，而是支持前端传入可选的时间范围参数：

- `startTime`
- `endTime`

在不传参数时，后端仍保持原有默认行为；传入时间范围时，则按指定区间聚合返回组件状态历史。

---

## 二、原始逻辑梳理

### 1. Controller 层原始逻辑

文件：`StatusPagePublicController.java`

#### 原 `/component` 接口
- 路径：`GET /api/status/page/public/component`
- **不接收任何时间范围参数**
- 直接调用：`statusPageService.queryComponentsStatus()`

#### 原 `/component/{id}` 接口
- 路径：`GET /api/status/page/public/component/{id}`
- **不接收任何时间范围参数**
- 直接调用：`statusPageService.queryComponentStatus(id)`

#### 原始结论
Controller 层原本是一个**固定窗口接口**：
- 前端无法通过参数影响 component 状态历史范围
- 后端永远按服务层默认逻辑返回结果

---

### 2. Service 接口层原始逻辑

文件：`StatusPageService.java`

原本只暴露两个与 component 状态历史相关的方法：

- `List<ComponentStatus> queryComponentsStatus()`
- `ComponentStatus queryComponentStatus(long id)`

这说明原始服务契约只有一种语义：

- 查询所有组件状态：默认固定窗口
- 查询单个组件状态：默认固定窗口

接口层**没有时间范围扩展点**。

---

### 3. Service 实现层原始逻辑

文件：`StatusPageServiceImpl.java`

这是本次改动的核心。

#### 3.1 原 `queryComponentsStatus()` 的逻辑

原逻辑步骤如下：

1. 查询全部组件：`statusPageComponentDao.findAll()`
2. 对每个组件单独构建 `ComponentStatus`
3. 对每个组件的历史数据，固定分成两段处理：
   - **今天**：从当天 00:00 到当前时间
   - **前 29 天**：从今天之前往前回溯 29 个自然日
4. 最终返回共 **30 个历史块**：
   - 1 个“今天”块
   - 29 个“前置日”块

#### 3.2 今天这 1 个块如何生成

- 查询当天历史记录：`findStatusPageHistoriesByComponentIdAndTimestampBetween(componentId, todayStartTimestamp, nowTimestamp)`
- 调用 `combineOneDayStatusPageHistory(...)` 做聚合

`combineOneDayStatusPageHistory(...)` 的原始规则：
- 如果没有记录：构造一个默认记录，状态取 `component.getState()`
- 如果只有 1 条记录：直接返回该条记录
- 如果有多条记录：
  - 按 `calculateStatus.getCalculateStatusIntervals()` 统计正常/异常/未知时长
  - 计算 uptime
  - 依据 abnormal / normal / unknown 推导最终状态

#### 3.3 前 29 天如何生成

原逻辑会：

1. 查询 `[preTimestamp, todayStartTimestamp]` 之间的所有历史记录
2. 按时间升序排序
3. 从“昨天 23:59:59”开始，逐天向前回溯 29 次
4. 每次取出一天内的所有记录，按以下规则处理：
   - **空集合**：生成一个 `UNKNOWN` 占位块
   - **1 条记录**：直接用这条记录
   - **多条记录**：调用 `combineOneDayStatusPageHistory(...)` 聚合，并且：
     - 删除这一天的旧记录 `deleteAll(thisDayHistory)`
     - 保存合并后的记录 `save(merged)`

#### 3.4 原 `queryComponentStatus(long id)` 的逻辑

它和 `queryComponentsStatus()` 基本重复，只是对象从“全部组件”变成“单个组件”：

1. 先按 id 查组件
2. 重复执行“今天 + 前 29 天”的固定窗口聚合
3. 最后返回该组件的 `ComponentStatus`

#### 3.5 原始逻辑的核心特点

原始后端逻辑有 4 个显著特点：

1. **窗口固定**：只能查默认 30 天
2. **按自然日聚合**：历史块的主要粒度是“天”
3. **今天单独计算**：今天不是完整自然日，而是“今日 00:00 到现在”
4. **查询过程带持久化副作用**：当某一天有多条历史记录时，会在查询时把这一天的原始记录合并并回写数据库

---

## 三、修改后的逻辑梳理

### 1. Controller 层修改后逻辑

文件：`StatusPagePublicController.java`

#### 新 `/component` 接口
现在变为：

- `GET /api/status/page/public/component?startTime=...&endTime=...`
- 新增可选参数：
  - `Long startTime`
  - `Long endTime`
- 调用改为：`statusPageService.queryComponentsStatus(startTime, endTime)`

#### 新 `/component/{id}` 接口
现在变为：

- `GET /api/status/page/public/component/{id}?startTime=...&endTime=...`
- 新增可选参数：
  - `Long startTime`
  - `Long endTime`
- 调用改为：`statusPageService.queryComponentStatus(id, startTime, endTime)`

#### 修改后结论
Controller 层从“固定窗口接口”变成了“**支持可选时间范围参数的接口**”。

但这里有一个重要点：
- 参数是**可选**的
- 不传参数时，仍应走默认逻辑，保持兼容

---

### 2. Service 接口层修改后逻辑

文件：`StatusPageService.java`

新增了两个重载方法：

- `List<ComponentStatus> queryComponentsStatus(Long startTime, Long endTime)`
- `ComponentStatus queryComponentStatus(long id, Long startTime, Long endTime)`

原来的无参方法仍然保留。

#### 修改后结论
Service 契约从“只有默认窗口”扩展成了“双语义”：

- **无参**：保持旧行为
- **有参**：执行范围查询

这使得兼容性相对好，因为旧调用方不需要改。

---

### 3. Service 实现层修改后逻辑

文件：`StatusPageServiceImpl.java`

这是最关键的变化。

---

#### 3.1 `queryComponentsStatus()` 的逻辑变化

修改后：

- 原无参方法不再自己展开完整聚合逻辑
- 改为直接委托：`return queryComponentsStatus(null, null);`

这意味着：

- 无参方法成为一个兼容入口
- 真实逻辑统一收敛到带参方法中

---

#### 3.2 新 `queryComponentsStatus(Long startTime, Long endTime)`

新逻辑：

1. 查询所有组件
2. 对每个组件执行：`buildComponentStatus(component, startTime, endTime)`
3. 汇总为列表返回

相比原先：
- 以前“查询全部组件”的逻辑全部写在一个大方法里
- 现在抽成统一的单组件构建过程，更容易复用

---

#### 3.3 新增 `buildComponentStatus(...)`

这是本次重构出来的核心分发方法。

逻辑是：

1. 创建 `ComponentStatus`
2. 设置 `info`
3. 根据参数决定走哪条路径：
   - `startTime != null` → `queryComponentHistoriesByRange(...)`
   - 否则 → `queryComponentHistoriesByDefaultWindow(...)`
4. 把 histories 填入 `componentStatus`
5. 返回结果

#### 这个方法的意义
它把原来分散在两个查询方法中的“构建组件状态”过程统一了。

---

#### 3.4 新 `queryComponentHistoriesByDefaultWindow(...)`

这个方法基本承接了原先“默认 30 天窗口”的历史逻辑。

它的行为仍然是：

1. 查询今天 00:00 到 now 的记录
2. 合并成今天块
3. 查询前 29 天记录
4. 从昨天开始逐天回溯 29 次
5. 对每一天：
   - 空集合 → 生成 UNKNOWN 占位块
   - 1 条记录 → 直接返回该记录
   - 多条记录 → 聚合、删除旧记录、保存新记录

#### 结论
默认窗口逻辑**没有本质改变**，只是从原方法中抽出来单独封装。

也就是说：
- 默认 30 天语义被保留了
- 查询时合并并回写数据库的副作用也仍然保留了

---

#### 3.5 新 `queryComponentHistoriesByRange(...)`

这是本次新增的真正业务逻辑。

它的目标是：
- 根据前端传入的 `startTime/endTime`
- 动态生成历史块，而不是固定 30 天

##### 逻辑步骤

1. 计算区间边界：
   - `rangeStartTime = startTime`
   - `rangeEndTime = endTime == null ? System.currentTimeMillis() : endTime`
   - 如果 `endTime < startTime`，则把 `rangeEndTime` 修正为 `rangeStartTime`

2. 查询该时间段内的所有历史记录

3. 排序后，根据区间总时长决定分桶粒度：
   - 如果区间 `<= 24h`：按 **1 小时** 为一个桶
   - 如果区间 `> 24h`：按 **1 天** 为一个桶

4. 计算桶数量：
   - `bucketCount = max(1, ceil(rangeDuration / bucketDuration))`

5. 从 `rangeEndTime` 往前倒推逐桶构建：
   - 每个桶计算 `[bucketStart, bucketEnd]`
   - 取出桶内历史记录
   - 桶内处理规则：
     - **空集合**：生成 `UNKNOWN` 占位块
     - **1 条记录**：直接复用该记录，但把 `timestamp` 改成 `bucketEnd`
     - **多条记录**：调用 `combineOneDayStatusPageHistory(...)` 聚合

6. 当已经回推到 `rangeStartTime` 时结束循环

##### 这段逻辑的实际语义
- 对于 24h 范围：返回按小时切分的历史块
- 对于更长范围：返回按天切分的历史块
- 返回块数量不再固定是 30，而是由时间范围决定

---

#### 3.6 `queryComponentStatus(long id)` 的逻辑变化

修改后无参方法：

- 改成直接委托 `queryComponentStatus(id, null, null)`

新增带参方法：

1. 根据 id 查组件
2. 调用 `buildComponentStatus(component, startTime, endTime)`
3. 返回结果

#### 结论
原先“单组件固定窗口查询”被改造成：
- 无参：兼容旧行为
- 有参：支持动态范围

---

## 四、原始逻辑 vs 修改后逻辑 对比

### 1. 接口能力变化

#### 原始逻辑
- `/component`
- `/component/{id}`

都只能返回固定窗口结果。

#### 修改后逻辑
- 两个接口都支持 `startTime/endTime`
- 无参保持兼容
- 有参时支持动态区间聚合

---

### 2. 默认行为是否变化

#### 原始逻辑
默认就是固定 30 天窗口。

#### 修改后逻辑
默认仍是固定 30 天窗口，因为：
- 无参调用会转发到带参方法
- `startTime == null` 时仍走 `queryComponentHistoriesByDefaultWindow(...)`

#### 结论
**默认行为理论上保持不变。**

---

### 3. 历史聚合模式变化

#### 原始逻辑
- 只能按“今天 + 前 29 天”模式返回
- 总块数固定 30

#### 修改后逻辑
- 默认路径仍是 30 天固定窗口
- 新增范围路径：
  - `<=24h` 按小时聚合
  - `>24h` 按天聚合
- 总块数根据时间范围动态变化

#### 结论
这次改动的本质，是在保留默认 30 天行为的基础上，新增了一个“可变窗口聚合器”。

---

### 4. 持久化副作用变化

#### 原始逻辑
在默认窗口逻辑下：
- 某一天历史记录多于 1 条时
- 会在查询过程中做合并，并删除旧记录、保存新记录

#### 修改后逻辑
- 默认窗口路径仍然保留这个副作用
- 新增范围查询路径中：
  - 多条记录会聚合
  - 但**不会 delete/save 回数据库**

#### 结论
两条路径的副作用行为不一致：

- 默认路径：会落库压缩
- 范围路径：只做内存聚合

这个差异不一定是 bug，但需要明确知道：
**现在“默认窗口查询”和“范围查询”不仅输出策略不同，连是否回写数据库也不同。**

---

## 五、这次后端改动的正向价值

### 1. 保持了兼容性
- 原无参方法保留
- 默认 30 天行为保留
- 原调用方不需要立刻全量修改

### 2. 把重复逻辑做了收敛
- 原先“全部组件”和“单组件”两套类似逻辑被收敛到 `buildComponentStatus(...)`
- 可读性和可维护性比之前更好

### 3. 支持新需求
- 可以支持前端请求 24h 视图
- 为后续支持更多时间范围提供了基础

---

## 六、我认为需要重点关注的点

### 1. 范围查询里单条记录分支会直接改写实体时间戳

在 `queryComponentHistoriesByRange(...)` 中，桶内只有 1 条记录时：

```java
StatusPageHistory history = bucketHistories.get(0);
history.setTimestamp(bucketEnd);
histories.add(history);
```

这意味着：
- 返回给前端的对象时间戳会被改成桶结束时间
- 但这个对象本身可能是 DAO 查出来的实体对象

风险点：
- 如果当前实体仍受持久化上下文管理，理论上存在被误写回数据库的可能
- 即使当前不会落库，这种“为了展示修改原实体字段”的写法也比较脆弱

更稳妥的方式通常是：
- 复制一个新对象再改 `timestamp`
- 不直接改 DAO 返回实体

---

### 2. 默认路径和范围路径的聚合副作用不一致

默认路径会：
- `deleteAll(...)`
- `save(merged)`

范围路径不会。

这会导致：
- 同样是“多条记录聚合”，两种查询路径对数据库的影响不同
- 以后如果有人假设“所有聚合查询都会顺便压缩历史记录”，就会出现认知偏差

如果这是有意设计，建议后续在代码注释或文档里明确。

---

### 3. `combineOneDayStatusPageHistory(...)` 被复用于小时桶聚合

这个方法名字和原始语义是“合并一天的状态历史”，但现在范围查询里 24h 模式下会拿它去处理**小时级桶**。

从实现上看它仍能工作，因为它本质是：
- 遍历多条状态记录
- 按固定采样间隔累计 normal/abnormal/unknown

但从语义上讲：
- 方法名已经不完全准确了
- 未来继续扩展粒度时，理解成本会增加

这不是功能错误，但属于设计上的“命名滞后”。

---

## 七、结论

### 原始逻辑一句话总结
原始后端逻辑是一个**固定 30 天窗口、按天聚合、并且默认查询过程中会做历史记录压缩回写**的实现。

### 修改后逻辑一句话总结
修改后后端逻辑变成了一个**兼容原有 30 天默认行为，同时支持按 `startTime/endTime` 做动态范围聚合（24h 按小时、长范围按天）的双模式实现**。

### 对这次改动的总体判断
从实现方向上看，这次后端改动是合理的，核心收益是：
- 保留默认行为
- 提供范围扩展能力
- 降低部分重复逻辑

但在 review 时我会重点盯下面两个点：

1. `queryComponentHistoriesByRange(...)` 中是否应该避免直接修改查询出来的 `StatusPageHistory` 实体
2. 默认窗口路径与范围路径的“是否回写数据库”差异，是否是明确且被接受的设计

---

## 八、文档用途说明

这个文档仅用于当前本地检查，不建议纳入提交内容。
