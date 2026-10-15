# 内容Schema

可执行的唯一Schema位于`src/domain/content.ts`，由Zod定义并同时用于浏览器导入、测试和电脑端内容工具，避免维护两份会漂移的校验规则。

`content-library`中的JSON是权威内容母本；`local-data/catalog.sqlite`只是可删除并重建的检索索引。
