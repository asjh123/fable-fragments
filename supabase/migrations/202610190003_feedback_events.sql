-- 增加内容反馈和跳过事件；学习记录仍保持只追加，不开放更新或删除。
alter table public.learning_events
  drop constraint if exists learning_events_event_type_check;

alter table public.learning_events
  add constraint learning_events_event_type_check check (event_type in (
    'FRAGMENT_COMPLETED', 'QUIZ_ANSWERED', 'CONCEPT_VIEWED',
    'NOTE_SAVED', 'STORY_STARTED', 'STORY_COMPLETED',
    'CONTENT_FEEDBACK_SUBMITTED', 'CONTENT_SKIPPED'
  ));
