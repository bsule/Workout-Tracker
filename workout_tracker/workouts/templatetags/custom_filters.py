from django import template

register = template.Library()

@register.filter
def zip_lists(list1, list2):
    list1 = list1.split(',')
    list2 = list2.split(',')
    list1.pop()
    list2.pop()
    return list(zip(list1, list2))

